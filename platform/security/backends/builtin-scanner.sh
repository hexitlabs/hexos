#!/usr/bin/env bash
# HexOS Phase 1.5 — Built-in Pattern Scanner Backend
# Regex-based pattern matching against categorized threat databases
# Returns JSON findings array on stdout
# Exit codes: 0=clean, 1=threats found, 3=error
set -uo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATTERNS_DIR="${BACKEND_DIR}/../patterns"

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------
usage() {
    echo "Usage: builtin-scanner.sh <scan-type> <target> [policy-file]"
    echo ""
    echo "Scan types:"
    echo "  file    <filepath>     Scan a single file"
    echo "  string  <text>         Scan a string (command / code)"
    echo "  dir     <dirpath>      Scan all files in a directory"
    echo ""
    echo "Returns JSON findings array on stdout."
    exit 3
}

[[ $# -lt 2 ]] && usage

SCAN_TYPE="$1"
TARGET="$2"
POLICY_FILE="${3:-}"

# ---------------------------------------------------------------------------
# Policy helpers  (lightweight YAML parsing — no external deps)
# ---------------------------------------------------------------------------
get_policy_extensions() {
    # Returns space-separated list of extensions from policy, or defaults
    if [[ -n "$POLICY_FILE" && -f "$POLICY_FILE" ]]; then
        local exts=""
        local in_section=false
        while IFS= read -r line; do
            if [[ "$line" =~ ^[[:space:]]+extensions: ]]; then
                in_section=true
                continue
            fi
            if $in_section; then
                # Stop at next key (non-list-item line that isn't blank)
                if [[ "$line" =~ ^[[:space:]]+[a-z_]+: ]] || [[ "$line" =~ ^[a-z] ]]; then
                    break
                fi
                if [[ "$line" =~ ^[[:space:]]*-[[:space:]]*(\..*) ]]; then
                    local ext="${BASH_REMATCH[1]}"
                    ext=$(echo "$ext" | tr -d '[:space:]"'"'")
                    exts="${exts} ${ext}"
                fi
            fi
        done < "$POLICY_FILE"
        exts=$(echo "$exts" | xargs)
        if [[ -n "$exts" ]]; then
            echo "$exts"
            return
        fi
    fi
    echo ".md .js .ts .py .sh .yaml .yml .json .txt .mjs .cjs .jsx .tsx"
}

get_policy_excludes() {
    if [[ -n "$POLICY_FILE" && -f "$POLICY_FILE" ]]; then
        local excl=""
        local in_section=false
        while IFS= read -r line; do
            if [[ "$line" =~ ^[[:space:]]+exclude: ]]; then
                in_section=true
                continue
            fi
            if $in_section; then
                if [[ "$line" =~ ^[[:space:]]+[a-z_]+: ]] || [[ "$line" =~ ^[a-z] ]]; then
                    break
                fi
                if [[ "$line" =~ ^[[:space:]]*-[[:space:]]*(.*) ]]; then
                    local val="${BASH_REMATCH[1]}"
                    val=$(echo "$val" | tr -d '"'"'")
                    excl="${excl} ${val}"
                fi
            fi
        done < "$POLICY_FILE"
        excl=$(echo "$excl" | xargs)
        if [[ -n "$excl" ]]; then
            echo "$excl"
            return
        fi
    fi
    echo "node_modules/ .git/ reports/ logs/"
}

get_policy_risk_action() {
    local level="$1"
    if [[ -n "$POLICY_FILE" && -f "$POLICY_FILE" ]]; then
        local action
        action=$(grep -A 10 'risk_levels:' "$POLICY_FILE" 2>/dev/null \
            | grep "^\s*${level}:" | head -1 \
            | sed 's/.*:\s*//' | tr -d '[:space:]')
        if [[ -n "$action" ]]; then
            echo "$action"
            return
        fi
    fi
    # Defaults
    case "$level" in
        critical|high) echo "fail" ;;
        medium) echo "warn" ;;
        low) echo "pass" ;;
        *) echo "warn" ;;
    esac
}

# ---------------------------------------------------------------------------
# Core pattern matching
# ---------------------------------------------------------------------------
FINDINGS=()
HIGHEST_RISK="none"  # none < low < medium < high < critical
EARLY_EXIT=false
EARLY_EXIT_WHEN_CRITICAL=false

# Determine if we should exit early when we find a critical risk
# (for string and file scans, we can break early; for dir scans we want to scan all)
if [[ "$SCAN_TYPE" == "string" || "$SCAN_TYPE" == "file" ]]; then
    EARLY_EXIT_WHEN_CRITICAL=true
fi

# Global patterns array: each element is "RISK_LEVEL|PATTERN_NAME|CATEGORY|REGEX"
declare -a PATTERNS=()

# Load all patterns from pattern files into the global array
load_patterns() {
    local pattern_file
    for pattern_file in "${PATTERNS_DIR}"/*.patterns; do
        [[ ! -f "$pattern_file" ]] && continue
        local category
        category=$(grep '^# Category:' "$pattern_file" | head -1 | sed 's/.*Category:\s*//')
        [[ -z "$category" ]] && category=$(basename "$pattern_file" .patterns)

        while IFS='|' read -r risk_level pattern_name regex; do
            # Skip comments & empty lines
            [[ "$risk_level" =~ ^# ]] && continue
            [[ -z "$regex" ]] && continue

            # Trim whitespace
            risk_level=$(echo "$risk_level" | tr -d '[:space:]')
            pattern_name=$(echo "$pattern_name" | tr -d '[:space:]')

            PATTERNS+=("${risk_level}|${pattern_name}|${category}|${regex}")
        done < "$pattern_file"
    done
}

# Load patterns once at script startup
load_patterns

risk_rank() {
    case "$1" in
        critical) echo 4 ;;
        high) echo 3 ;;
        medium) echo 2 ;;
        low) echo 1 ;;
        *) echo 0 ;;
    esac
}

update_highest_risk() {
    local new_rank old_rank
    new_rank=$(risk_rank "$1")
    old_rank=$(risk_rank "$HIGHEST_RISK")
    if [[ $new_rank -gt $old_rank ]]; then
        HIGHEST_RISK="$1"
        if [[ "$EARLY_EXIT_WHEN_CRITICAL" == "true" && "$HIGHEST_RISK" == "critical" ]]; then
            EARLY_EXIT=true
        fi
    fi
}

# Escape string for JSON
json_escape() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    printf '%s' "$s"
}

scan_content() {
    local content="$1"
    local source_file="${2:-<string>}"

    for pattern_file in "${PATTERNS_DIR}"/*.patterns; do
        [[ ! -f "$pattern_file" ]] && continue
        local category
        category=$(grep '^# Category:' "$pattern_file" | head -1 | sed 's/.*Category:\s*//')
        [[ -z "$category" ]] && category=$(basename "$pattern_file" .patterns)

        while IFS='|' read -r risk_level pattern_name regex; do
            # Skip comments & empty lines
            [[ "$risk_level" =~ ^# ]] && continue
            [[ -z "$regex" ]] && continue

            # Trim whitespace
            risk_level=$(echo "$risk_level" | tr -d '[:space:]')
            pattern_name=$(echo "$pattern_name" | tr -d '[:space:]')

            # Attempt match with grep -P (PCRE); fall back to grep -E (ERE)
            local matched_line=""
            matched_line=$(echo "$content" | grep -Pn "$regex" 2>/dev/null | head -1) || \
            matched_line=$(echo "$content" | grep -En "$regex" 2>/dev/null | head -1) || true

            if [[ -n "$matched_line" ]]; then
                local line_num match_text
                line_num=$(echo "$matched_line" | cut -d: -f1)
                match_text=$(echo "$matched_line" | cut -d: -f2-)
                # Truncate match for readability
                if [[ ${#match_text} -gt 120 ]]; then
                    match_text="${match_text:0:120}..."
                fi

                update_highest_risk "$risk_level"

                local escaped_match escaped_file escaped_pattern
                escaped_match=$(json_escape "$match_text")
                escaped_file=$(json_escape "$source_file")
                escaped_pattern=$(json_escape "$pattern_name")

                FINDINGS+=("{\"category\":\"${category}\",\"risk\":\"${risk_level}\",\"pattern\":\"${escaped_pattern}\",\"file\":\"${escaped_file}\",\"line\":${line_num:-0},\"match\":\"${escaped_match}\"}")
            fi
            
            # Early exit optimization: if we found a critical risk and can exit early, do so
            if [[ "$EARLY_EXIT" == "true" && "$HIGHEST_RISK" == "critical" ]]; then
                return
            fi
        done < "$pattern_file"
        
        # Early exit between pattern files
        if [[ "$EARLY_EXIT" == "true" && "$HIGHEST_RISK" == "critical" ]]; then
            return
        fi
    done
}

scan_file() {
    local filepath="$1"
    [[ ! -f "$filepath" ]] && return

    # Size check — skip files larger than 1MB
    local size
    size=$(stat -c%s "$filepath" 2>/dev/null || stat -f%z "$filepath" 2>/dev/null || echo 0)
    [[ $size -gt 1048576 ]] && return

    # Binary check — skip binary files
    if file "$filepath" 2>/dev/null | grep -qi 'binary\|executable\|ELF\|archive\|image\|audio\|video'; then
        return
    fi

    local content
    content=$(cat "$filepath" 2>/dev/null) || return
    scan_content "$content" "$filepath"
}

should_scan_file() {
    local filepath="$1"
    local filename
    filename=$(basename "$filepath")
    local ext=".${filename##*.}"

    # Check extension whitelist
    local extensions
    extensions=$(get_policy_extensions)
    local match=false
    for e in $extensions; do
        if [[ "$ext" == "$e" ]]; then
            match=true
            break
        fi
    done

    # If filename has no extension, scan it anyway (scripts, configs)
    if [[ "$filename" == "${filename%.*}" ]]; then
        match=true
    fi

    # Files named Makefile, Dockerfile, etc.
    if [[ "$filename" =~ ^(Makefile|Dockerfile|Vagrantfile|Rakefile|Gemfile|Procfile)$ ]]; then
        match=true
    fi

    $match
}

is_excluded() {
    local filepath="$1"
    local excludes
    excludes=$(get_policy_excludes)
    for excl in $excludes; do
        if [[ "$filepath" == *"$excl"* ]]; then
            return 0
        fi
    done
    return 1
}

# ---------------------------------------------------------------------------
# Main dispatch
# ---------------------------------------------------------------------------
case "$SCAN_TYPE" in
    string)
        scan_content "$TARGET"
        ;;
    file)
        [[ ! -f "$TARGET" ]] && echo '{"error":"File not found"}' && exit 3
        scan_file "$TARGET"
        ;;
    dir)
        [[ ! -d "$TARGET" ]] && echo '{"error":"Directory not found"}' && exit 3
        while IFS= read -r -d '' filepath; do
            is_excluded "$filepath" && continue
            should_scan_file "$filepath" && scan_file "$filepath"
        done < <(find "$TARGET" -type f -print0 2>/dev/null)
        ;;
    *)
        usage
        ;;
esac

# ---------------------------------------------------------------------------
# Output JSON result
# ---------------------------------------------------------------------------
FINDINGS_JSON=""
if [[ ${#FINDINGS[@]} -gt 0 ]]; then
    FINDINGS_JSON=$(printf '%s,' "${FINDINGS[@]}")
    FINDINGS_JSON="${FINDINGS_JSON%,}"
fi

echo "{\"scanner\":\"builtin\",\"total_findings\":${#FINDINGS[@]},\"highest_risk\":\"${HIGHEST_RISK}\",\"findings\":[${FINDINGS_JSON}]}"

# Exit code based on highest risk
if [[ ${#FINDINGS[@]} -eq 0 ]]; then
    exit 0
fi

case "$HIGHEST_RISK" in
    critical|high) exit 1 ;;
    medium) exit 2 ;;
    low) exit 0 ;;
    *) exit 0 ;;
esac
