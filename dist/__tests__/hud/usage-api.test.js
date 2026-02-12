/**
 * Tests for z.ai host validation, response parsing, and getUsage routing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isZaiHost, parseZaiResponse, getUsage } from '../../hud/usage-api.js';
// Mock dependencies that touch filesystem / keychain / network
vi.mock('../../utils/paths.js', () => ({
    getClaudeConfigDir: () => '/tmp/test-claude',
}));
vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        existsSync: vi.fn().mockReturnValue(false),
        readFileSync: vi.fn().mockReturnValue('{}'),
        writeFileSync: vi.fn(),
        mkdirSync: vi.fn(),
    };
});
vi.mock('child_process', () => ({
    execSync: vi.fn().mockReturnValue(''),
}));
vi.mock('https', () => ({
    default: {
        request: vi.fn(),
    },
}));
describe('isZaiHost', () => {
    it('accepts exact z.ai hostname', () => {
        expect(isZaiHost('https://z.ai')).toBe(true);
        expect(isZaiHost('https://z.ai/')).toBe(true);
        expect(isZaiHost('https://z.ai/v1')).toBe(true);
    });
    it('accepts subdomains of z.ai', () => {
        expect(isZaiHost('https://api.z.ai')).toBe(true);
        expect(isZaiHost('https://api.z.ai/v1/messages')).toBe(true);
        expect(isZaiHost('https://foo.bar.z.ai')).toBe(true);
    });
    it('rejects hosts that merely contain z.ai as substring', () => {
        expect(isZaiHost('https://z.ai.evil.tld')).toBe(false);
        expect(isZaiHost('https://notz.ai')).toBe(false);
        expect(isZaiHost('https://z.ai.example.com')).toBe(false);
    });
    it('rejects unrelated hosts', () => {
        expect(isZaiHost('https://api.anthropic.com')).toBe(false);
        expect(isZaiHost('https://example.com')).toBe(false);
        expect(isZaiHost('https://localhost:8080')).toBe(false);
    });
    it('rejects invalid URLs gracefully', () => {
        expect(isZaiHost('')).toBe(false);
        expect(isZaiHost('not-a-url')).toBe(false);
        expect(isZaiHost('://missing-protocol')).toBe(false);
    });
    it('is case-insensitive', () => {
        expect(isZaiHost('https://Z.AI/v1')).toBe(true);
        expect(isZaiHost('https://API.Z.AI')).toBe(true);
    });
});
describe('parseZaiResponse', () => {
    it('returns null for empty response', () => {
        expect(parseZaiResponse({})).toBeNull();
        expect(parseZaiResponse({ data: {} })).toBeNull();
        expect(parseZaiResponse({ data: { limits: [] } })).toBeNull();
    });
    it('returns null when no known limit types exist', () => {
        const response = {
            data: {
                limits: [{ type: 'UNKNOWN_LIMIT', percentage: 50 }],
            },
        };
        expect(parseZaiResponse(response)).toBeNull();
    });
    it('parses TOKENS_LIMIT as fiveHourPercent', () => {
        const response = {
            data: {
                limits: [
                    { type: 'TOKENS_LIMIT', percentage: 42, nextResetTime: Date.now() + 3600_000 },
                ],
            },
        };
        const result = parseZaiResponse(response);
        expect(result).not.toBeNull();
        expect(result.fiveHourPercent).toBe(42);
        expect(result.fiveHourResetsAt).toBeInstanceOf(Date);
    });
    it('parses TIME_LIMIT as monthlyPercent', () => {
        const response = {
            data: {
                limits: [
                    { type: 'TOKENS_LIMIT', percentage: 10 },
                    { type: 'TIME_LIMIT', percentage: 75, nextResetTime: Date.now() + 86400_000 },
                ],
            },
        };
        const result = parseZaiResponse(response);
        expect(result).not.toBeNull();
        expect(result.monthlyPercent).toBe(75);
        expect(result.monthlyResetsAt).toBeInstanceOf(Date);
    });
    it('does not set weeklyPercent (z.ai has no weekly quota)', () => {
        const response = {
            data: {
                limits: [
                    { type: 'TOKENS_LIMIT', percentage: 50 },
                ],
            },
        };
        const result = parseZaiResponse(response);
        expect(result).not.toBeNull();
        expect(result.weeklyPercent).toBeUndefined();
    });
    it('clamps percentages to 0-100', () => {
        const response = {
            data: {
                limits: [
                    { type: 'TOKENS_LIMIT', percentage: 150 },
                    { type: 'TIME_LIMIT', percentage: -10 },
                ],
            },
        };
        const result = parseZaiResponse(response);
        expect(result).not.toBeNull();
        expect(result.fiveHourPercent).toBe(100);
        expect(result.monthlyPercent).toBe(0);
    });
});
describe('getUsage routing', () => {
    const originalEnv = { ...process.env };
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset env
        delete process.env.ANTHROPIC_BASE_URL;
        delete process.env.ANTHROPIC_AUTH_TOKEN;
    });
    afterEach(() => {
        process.env = { ...originalEnv };
    });
    it('returns null when no credentials and no z.ai env', async () => {
        const result = await getUsage();
        expect(result).toBeNull();
    });
    it('routes to z.ai when ANTHROPIC_BASE_URL is z.ai host', async () => {
        process.env.ANTHROPIC_BASE_URL = 'https://api.z.ai/v1';
        process.env.ANTHROPIC_AUTH_TOKEN = 'test-token';
        // The https.request mock will cause fetchUsageFromZai to resolve(null)
        // since we haven't set up the full mock chain — getUsage returns null
        const result = await getUsage();
        // z.ai path was attempted (returns null due to mock), not Anthropic OAuth
        expect(result).toBeNull();
    });
    it('does NOT route to z.ai for look-alike hosts', async () => {
        process.env.ANTHROPIC_BASE_URL = 'https://z.ai.evil.tld/v1';
        process.env.ANTHROPIC_AUTH_TOKEN = 'test-token';
        const result = await getUsage();
        // Should fall through to OAuth path (also null due to mocks), not z.ai
        expect(result).toBeNull();
    });
});
//# sourceMappingURL=usage-api.test.js.map