/**
 * tmux Session Detection for Notifications
 *
 * Detects the current tmux session name for inclusion in notification payloads.
 */
import { execSync } from "child_process";
/**
 * Get the current tmux session name.
 * Returns null if not running inside tmux.
 */
export function getCurrentTmuxSession() {
    // Check if we're inside a tmux session
    if (!process.env.TMUX) {
        return null;
    }
    try {
        const sessionName = execSync("tmux display-message -p '#S'", {
            encoding: "utf-8",
            timeout: 3000,
            stdio: ["pipe", "pipe", "pipe"],
        }).trim();
        return sessionName || null;
    }
    catch {
        return null;
    }
}
/**
 * List active omc-team tmux sessions for a given team.
 */
export function getTeamTmuxSessions(teamName) {
    const sanitized = teamName.replace(/[^a-zA-Z0-9-]/g, "");
    if (!sanitized)
        return [];
    const prefix = `omc-team-${sanitized}-`;
    try {
        const output = execSync("tmux list-sessions -F '#{session_name}'", {
            encoding: "utf-8",
            timeout: 3000,
            stdio: ["pipe", "pipe", "pipe"],
        });
        return output
            .trim()
            .split("\n")
            .filter((s) => s.startsWith(prefix))
            .map((s) => s.slice(prefix.length));
    }
    catch {
        return [];
    }
}
/**
 * Format tmux session info for human-readable display.
 * Returns null if not in tmux.
 */
export function formatTmuxInfo() {
    const session = getCurrentTmuxSession();
    if (!session)
        return null;
    return `tmux: ${session}`;
}
//# sourceMappingURL=tmux.js.map