/**
 * Notification Configuration Reader
 *
 * Reads notification config from .omc-config.json and provides
 * backward compatibility with the old stopHookCallbacks format.
 */
import type { NotificationConfig, NotificationEvent, NotificationPlatform } from "./types.js";
/**
 * Validate Discord mention format: <@USER_ID> or <@&ROLE_ID>.
 * Returns the mention string if valid, undefined otherwise.
 */
export declare function validateMention(raw: string | undefined): string | undefined;
/**
 * Parse a validated mention into allowed_mentions structure for Discord API.
 */
export declare function parseMentionAllowedMentions(mention: string | undefined): {
    users?: string[];
    roles?: string[];
};
/**
 * Build notification config from environment variables.
 * This enables zero-config notification setup - just set env vars in .zshrc.
 */
export declare function buildConfigFromEnv(): NotificationConfig | null;
/**
 * Get the notification configuration.
 *
 * Reads from .omc-config.json, looking for the `notifications` key.
 * When file config exists, env-derived platforms are merged in to fill
 * missing platform blocks (file fields take precedence).
 * Falls back to migrating old `stopHookCallbacks` if present.
 * Returns null if no notification config is found.
 */
export declare function getNotificationConfig(): NotificationConfig | null;
/**
 * Check if a specific event has any enabled platform.
 */
export declare function isEventEnabled(config: NotificationConfig, event: NotificationEvent): boolean;
/**
 * Get list of enabled platforms for an event.
 */
export declare function getEnabledPlatforms(config: NotificationConfig, event: NotificationEvent): NotificationPlatform[];
//# sourceMappingURL=config.d.ts.map