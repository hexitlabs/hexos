#!/usr/bin/env bash
set -euo pipefail

# HexOS Phase 1 — Workspace Jail: Client Stats Script
# Shows status, resource usage, and health info for client jails

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_DIR="$(dirname "$SCRIPT_DIR")"
export PATH="/usr/sbin:/sbin:${PATH}"

usage() {
    echo "Usage: hexos-client-stats.sh [<client-name>|--all]"
    echo ""
    echo "Shows status and resource usage for HexOS clients."
    echo ""
    echo "Options:"
    echo "  <client-name>    Show detailed stats for a specific client"
    echo "  --all            Show summary table for all clients"
    exit 1
}

show_client_stats() {
    local client="$1"
    local client_user="hexos-${client}"
    local client_home="/hexos/${client}"
    local service="hexos-agent@${client}.service"

    # Check if client exists
    if ! id "$client_user" &>/dev/null; then
        echo "Error: Client '${client}' does not exist (no user ${client_user})"
        return 1
    fi

    # Get service status
    local status="unknown"
    local pid="-"
    local uptime="-"
    local memory="-"

    if systemctl is-active "$service" &>/dev/null; then
        status="running"
        pid=$(systemctl show "$service" --property=MainPID --value 2>/dev/null || echo "-")
        
        # Get uptime
        local active_since
        active_since=$(systemctl show "$service" --property=ActiveEnterTimestamp --value 2>/dev/null)
        if [[ -n "$active_since" && "$active_since" != "n/a" ]]; then
            uptime="$active_since"
        fi
        
        # Get memory from cgroup
        memory=$(systemctl show "$service" --property=MemoryCurrent --value 2>/dev/null || echo "-")
        if [[ "$memory" =~ ^[0-9]+$ ]]; then
            memory="$((memory / 1024 / 1024))MB"
        fi
    elif systemctl is-failed "$service" &>/dev/null; then
        status="failed"
    elif systemctl is-enabled "$service" &>/dev/null; then
        status="stopped"
    else
        status="not-configured"
    fi

    # Get disk usage
    local disk_usage="-"
    if [[ -d "$client_home" ]]; then
        disk_usage=$(du -sh "$client_home" 2>/dev/null | cut -f1 || echo "-")
    fi

    # Get task count
    local tasks="-"
    if [[ "$status" == "running" ]]; then
        tasks=$(systemctl show "$service" --property=TasksCurrent --value 2>/dev/null || echo "-")
    fi

    if [[ "${2:-}" == "--brief" ]]; then
        # Brief format for --all table
        printf "  %-20s %-12s %-8s %-10s %-10s %-8s\n" \
            "$client" "$status" "$pid" "$memory" "$disk_usage" "$tasks"
    else
        # Detailed format
        echo "╔══════════════════════════════════════════════════╗"
        echo "║  Client: ${client}"
        echo "╚══════════════════════════════════════════════════╝"
        echo ""
        echo "  User:       ${client_user} (uid=$(id -u "$client_user"))"
        echo "  Home:       ${client_home}"
        echo "  Service:    ${service}"
        echo "  Status:     ${status}"
        echo "  PID:        ${pid}"
        echo "  Uptime:     ${uptime}"
        echo "  Memory:     ${memory}"
        echo "  Disk:       ${disk_usage}"
        echo "  Tasks:      ${tasks}"
        echo ""
        
        # Show recent log entries if logs exist
        if [[ -f "${client_home}/logs/gateway.err.log" ]]; then
            echo "  Recent errors:"
            tail -5 "${client_home}/logs/gateway.err.log" 2>/dev/null | sed 's/^/    /'
            echo ""
        fi
    fi
}

show_all_clients() {
    echo "╔══════════════════════════════════════════════════════════════════════════╗"
    echo "║  HexOS Client Summary                                                   ║"
    echo "╚══════════════════════════════════════════════════════════════════════════╝"
    echo ""
    printf "  %-20s %-12s %-8s %-10s %-10s %-8s\n" \
        "CLIENT" "STATUS" "PID" "MEMORY" "DISK" "TASKS"
    printf "  %-20s %-12s %-8s %-10s %-10s %-8s\n" \
        "────────────────────" "────────────" "────────" "──────────" "──────────" "────────"

    local count=0
    local running=0
    local stopped=0
    local failed=0

    for client_dir in /hexos/*/; do
        client=$(basename "$client_dir")
        [[ "$client" == "platform" || "$client" == "shared" ]] && continue
        
        client_user="hexos-${client}"
        if ! id "$client_user" &>/dev/null; then
            continue
        fi

        count=$((count + 1))
        show_client_stats "$client" --brief

        # Count statuses
        service="hexos-agent@${client}.service"
        if systemctl is-active "$service" &>/dev/null; then
            running=$((running + 1))
        elif systemctl is-failed "$service" &>/dev/null; then
            failed=$((failed + 1))
        else
            stopped=$((stopped + 1))
        fi
    done

    if [[ $count -eq 0 ]]; then
        echo "  (no clients found)"
    fi

    echo ""
    echo "  Total: ${count} | Running: ${running} | Stopped: ${stopped} | Failed: ${failed}"
}

# Main
if [[ $# -eq 0 ]]; then
    usage
elif [[ "$1" == "--all" ]]; then
    show_all_clients
else
    show_client_stats "$1"
fi
