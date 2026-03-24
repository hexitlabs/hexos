#!/usr/bin/env bash
# HexOS Phase 1.5 — Built-in Pattern Scanner Backend (Optimized)
# Regex-based pattern matching against categorized threat databases.
# Returns JSON findings on stdout.
# Exit codes: 0=clean, 1=threats found, 3=error
#
# Performance architecture:
#   - Pattern files are cached in /tmp/hexos-pattern-cache/ and rebuilt only
#     when their modification fingerprint changes.
#   - Pass 1 (fast rejection): a single "grep -f" across ALL patterns rejects
#     clean content with one subprocess call.
#   - Pass 2 (identification): a single Perl process tests hit lines against
#     every pattern without spawning additional subprocesses.
#   - Dir scans bulk-grep all qualifying files in one grep invocation.
#   - Policy settings are parsed once per invocation (not per file).
set -uo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATTERNS_DIR="${BACKEND_DIR}/../patterns"

[[ $# -lt 2 ]] && {
    echo "Usage: builtin-scanner.sh <scan-type> <target> [policy-file]"
    exit 3
}

SCAN_TYPE="$1"
TARGET="$2"
POLICY_FILE="${3:-}"

# ---------------------------------------------------------------------------
# Policy helpers — parsed ONCE per invocation, stored in module-level vars
# ---------------------------------------------------------------------------
_POL_EXT=""
_POL_EXCL=""
_POL_PARSED=false

_parse_policy() {
    [[ "$_POL_PARSED" == "true" ]] && return
    _POL_PARSED=true

    if [[ -n "$POLICY_FILE" && -f "$POLICY_FILE" ]]; then
        local in_ext=false in_excl=false
        while IFS= read -r line; do
            if   [[ "$line" =~ ^[[:space:]]+extensions: ]]; then in_ext=true;  in_excl=false; continue
            elif [[ "$line" =~ ^[[:space:]]+exclude: ]];    then in_excl=true; in_ext=false;  continue
            elif [[ "$line" =~ ^([[:space:]]+[a-z_]+:|[a-z]) ]]; then in_ext=false; in_excl=false; fi

            if $in_ext && [[ "$line" =~ ^[[:space:]]*-[[:space:]]*(\..*) ]]; then
                local e="${BASH_REMATCH[1]//[[:space:]]/}"
                e="${e//\"/}"; e="${e//\'/}"
                _POL_EXT="${_POL_EXT} ${e}"
            fi
            if $in_excl && [[ "$line" =~ ^[[:space:]]*-[[:space:]]*(.*) ]]; then
                local v="${BASH_REMATCH[1]//\"/}"
                v="${v//\'/}"
                _POL_EXCL="${_POL_EXCL} ${v}"
            fi
        done < "$POLICY_FILE"
        _POL_EXT="${_POL_EXT# }"; _POL_EXT="${_POL_EXT% }"
        _POL_EXCL="${_POL_EXCL# }"; _POL_EXCL="${_POL_EXCL% }"
    fi

    [[ -z "$_POL_EXT" ]]  && _POL_EXT=".md .js .ts .py .sh .yaml .yml .json .txt .mjs .cjs .jsx .tsx"
    [[ -z "$_POL_EXCL" ]] && _POL_EXCL="node_modules/ .git/ reports/ logs/"
}

# Call once here so $_POL_EXT / $_POL_EXCL are populated for all helpers below
_parse_policy

get_policy_extensions() { echo "$_POL_EXT"; }
get_policy_excludes()   { echo "$_POL_EXCL"; }

# ---------------------------------------------------------------------------
# Pattern cache — built on first use, invalidated when pattern files change
# ---------------------------------------------------------------------------
_CACHE_DIR="/tmp/hexos-pattern-cache"
_GREP_FILE="${_CACHE_DIR}/all.grep"   # ERE patterns for grep -Ei -f ((?i) stripped)
_META_FILE="${_CACHE_DIR}/all.meta"   # risk|name|category|regex  (one per line)
_PERL_FILE="${_CACHE_DIR}/pass2.pl"   # Perl script for pass-2 matching
_FP_FILE="${_CACHE_DIR}/fingerprint"

_fingerprint() {
    find "${PATTERNS_DIR}" -name '*.patterns' -type f -print0 2>/dev/null \
        | sort -z \
        | xargs -0 stat -c '%Y%s' 2>/dev/null \
        | md5sum \
        | cut -d' ' -f1
}

_build_cache() {
    mkdir -p "$_CACHE_DIR"
    : > "$_GREP_FILE"
    : > "$_META_FILE"

    for pf in "${PATTERNS_DIR}"/*.patterns; do
        [[ ! -f "$pf" ]] && continue
        local category
        category=$(grep '^# Category:' "$pf" 2>/dev/null | head -1 \
                   | sed 's/.*Category:\s*//' | tr -d '[:space:]')
        [[ -z "$category" ]] && category=$(basename "$pf" .patterns)

        while IFS='|' read -r rl pn rx; do
            [[ "$rl" =~ ^# || -z "$rx" ]] && continue
            rl="${rl//[[:space:]]/}"; pn="${pn//[[:space:]]/}"
            # Meta: full regex (including (?i) — Perl handles it natively)
            printf '%s|%s|%s|%s\n' "$rl" "$pn" "$category" "$rx" >> "$_META_FILE"
            # Grep file: strip (?i) — we use global -i on the grep call
            echo "${rx//\(\?i\)/}" >> "$_GREP_FILE"
        done < "$pf"
    done

    # Write the Perl pass-2 script
    cat > "$_PERL_FILE" << 'PERL'
#!/usr/bin/perl
# HexOS scanner pass-2: identify which patterns matched hit lines.
# Args: meta_file  source_file
#   source_file = ""  → input lines are "filepath:lnum:text" (grep -H format)
#   source_file = X   → input lines are "lnum:text" (grep -n, no filename)
# Output: risk|name|category|filepath|lnum|match_text   (one per match)
use strict; use warnings;

my ($meta_file, $src_file) = @ARGV;

# Load pattern metadata
open(my $mf, '<', $meta_file) or die "Cannot open $meta_file: $!";
my (@R, @N, @C, @X);
while (<$mf>) {
    chomp;
    my ($r, $n, $c, $x) = split /\|/, $_, 4;
    push @R, $r; push @N, $n; push @C, $c; push @X, $x;
}
close $mf;
my $np = scalar @R;

# Process hit lines from stdin
while (my $line = <STDIN>) {
    chomp $line;
    next unless length $line;

    my ($filepath, $lnum, $ltext);
    if ($src_file ne '') {
        # Format: linenum:text
        ($lnum, $ltext) = $line =~ /^(\d+):(.*)/s;
        $filepath = $src_file;
    } else {
        # Format: filepath:linenum:text  (grep -H output)
        # Use lazy match so colons in filepath are handled correctly
        ($filepath, $lnum, $ltext) = $line =~ /^(.+?):(\d+):(.*)/s;
    }
    next unless defined $lnum && defined $ltext;

    # Truncate long lines for display
    my $disp = length($ltext) > 120 ? substr($ltext, 0, 120) . '...' : $ltext;

    for my $i (0 .. $np - 1) {
        my $matched = 0;
        # eval to catch regex compile errors (malformed patterns)
        eval { $matched = ($ltext =~ /$X[$i]/) };
        next unless $matched;

        # Use a field separator unlikely to appear in data
        # Replace literal | with a placeholder so fields stay intact
        (my $ef = $filepath) =~ s/\|/\x01/g;
        (my $ed = $disp)     =~ s/\|/\x01/g;
        print "$R[$i]|$N[$i]|$C[$i]|$ef|$lnum|$ed\n";
    }
}
PERL
    chmod +x "$_PERL_FILE"
    _fingerprint > "$_FP_FILE"
}

_ensure_cache() {
    local cur
    cur=$(_fingerprint)
    if [[ ! -f "$_GREP_FILE" || ! -f "$_META_FILE" \
       || ! -f "$_PERL_FILE" || ! -f "$_FP_FILE" ]] \
    || [[ "$cur" != "$(cat "$_FP_FILE" 2>/dev/null)" ]]; then
        _build_cache
    fi
}

_ensure_cache

# ---------------------------------------------------------------------------
# Scan engine
# ---------------------------------------------------------------------------
FINDINGS=()
HIGHEST_RISK="none"
HIGHEST_RANK=0

# Inline risk ranking — no subshell
update_risk() {
    local r=0
    case "$1" in critical) r=4;; high) r=3;; medium) r=2;; low) r=1;; esac
    if [[ $r -gt $HIGHEST_RANK ]]; then
        HIGHEST_RANK=$r
        HIGHEST_RISK="$1"
    fi
}

json_escape() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    printf '%s' "$s"
}

# Consume pass-2 Perl output (risk|name|cat|file|lnum|match) into FINDINGS
# NOTE: Must be called via process substitution (< <(...)) NOT pipeline (|)
# to avoid subshell variable scoping issues.
_ingest_perl_out() {
    local infile="$1"
    while IFS='|' read -r risk name cat filepath lnum match; do
        [[ -z "$risk" ]] && continue
        # Restore escaped pipe placeholder
        filepath="${filepath//$'\x01'/|}"
        match="${match//$'\x01'/|}"
        update_risk "$risk"
        local em ef ep
        em=$(json_escape "$match")
        ef=$(json_escape "$filepath")
        ep=$(json_escape "$name")
        FINDINGS+=("{\"category\":\"${cat}\",\"risk\":\"${risk}\",\"pattern\":\"${ep}\",\"file\":\"${ef}\",\"line\":${lnum},\"match\":\"${em}\"}")
    done < "$infile"
}

# Scan a string of content (for "string" scan-type, or called per-file from scan_file)
scan_content() {
    local content="$1"
    local source_file="${2:-<string>}"

    # Pass 1 — reject clean content with a single grep
    local hits
    hits=$(printf '%s\n' "$content" | grep -Ein -f "$_GREP_FILE" 2>/dev/null) || true
    [[ -z "$hits" ]] && return

    # Pass 2 — single Perl process identifies which pattern(s) matched each hit line
    # Use temp file to avoid subshell scoping (pipeline loses FINDINGS changes)
    local perl_out
    perl_out=$(mktemp /tmp/hexos-perl-XXXXXX)
    printf '%s\n' "$hits" \
        | perl "$_PERL_FILE" "$_META_FILE" "$source_file" 2>/dev/null \
        > "$perl_out"
    _ingest_perl_out "$perl_out"
    rm -f "$perl_out"
}

# Scan a single file (for "file" scan-type)
scan_file() {
    local fp="$1"
    [[ ! -f "$fp" ]] && return

    local sz
    sz=$(stat -c%s "$fp" 2>/dev/null || echo 0)
    [[ $sz -gt 1048576 ]] && return

    # Fast binary-type rejection by extension (no subprocess)
    case "${fp##*.}" in
        png|jpg|jpeg|gif|webp|ico|bmp|tiff|svg|mp3|mp4|wav|ogg|flac|\
        zip|gz|bz2|xz|7z|rar|tar|\
        so|o|a|dll|exe|class|pyc|wasm|bin|db|sqlite)
            return ;;
    esac

    local content
    content=$(cat "$fp" 2>/dev/null) || return
    scan_content "$content" "$fp"
}

# Helpers for dir/file filtering
should_scan_file() {
    local fn="${1##*/}" ext=".${1##*.}"
    for e in $_POL_EXT; do [[ "$ext" == "$e" ]] && return 0; done
    [[ "$fn" == "${fn%.*}" ]] && return 0   # no extension → scan anyway
    [[ "$fn" =~ ^(Makefile|Dockerfile|Vagrantfile|Rakefile|Gemfile|Procfile)$ ]] && return 0
    return 1
}

is_excluded() {
    local fp="$1"
    for excl in $_POL_EXCL; do [[ "$fp" == *"$excl"* ]] && return 0; done
    return 1
}

# Scan all qualifying files in a directory — single grep + single Perl call
scan_dir() {
    local dir="$1"

    # Build a list of qualifying files into a temp file (null-delimited for xargs)
    local list_f
    list_f=$(mktemp /tmp/hexos-flist-XXXXXX)

    while IFS= read -r -d '' fp; do
        is_excluded "$fp" && continue
        should_scan_file "$fp" || continue
        local sz
        sz=$(stat -c%s "$fp" 2>/dev/null || echo 0)
        [[ $sz -gt 1048576 ]] && continue
        # Fast extension-based binary skip
        case "${fp##*.}" in
            png|jpg|jpeg|gif|webp|ico|bmp|tiff|svg|mp3|mp4|wav|ogg|flac|\
            zip|gz|bz2|xz|7z|rar|tar|\
            so|o|a|dll|exe|class|pyc|wasm|bin|db|sqlite)
                continue ;;
        esac
        printf '%s\0' "$fp"
    done < <(find "$dir" -type f -print0 2>/dev/null) > "$list_f"

    # Abort cleanly if nothing to scan
    if [[ ! -s "$list_f" ]]; then
        rm -f "$list_f"
        return
    fi

    # Pass 1 — single grep across ALL files (xargs handles ARG_MAX safely)
    local hits
    hits=$(xargs -0 grep -EHin -f "$_GREP_FILE" 2>/dev/null < "$list_f") || true
    rm -f "$list_f"
    [[ -z "$hits" ]] && return

    # Pass 2 — single Perl process for all hit lines (no filepath prefix → leave empty)
    local perl_out
    perl_out=$(mktemp /tmp/hexos-perl-XXXXXX)
    printf '%s\n' "$hits" \
        | perl "$_PERL_FILE" "$_META_FILE" "" 2>/dev/null \
        > "$perl_out"
    _ingest_perl_out "$perl_out"
    rm -f "$perl_out"
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
        scan_dir "$TARGET"
        ;;
    *)
        echo "Usage: builtin-scanner.sh {string|file|dir} <target> [policy]"
        exit 3
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

[[ ${#FINDINGS[@]} -eq 0 ]] && exit 0
case "$HIGHEST_RISK" in
    critical|high) exit 1 ;;
    medium)        exit 2 ;;
    low)           exit 0 ;;
    *)             exit 0 ;;
esac
