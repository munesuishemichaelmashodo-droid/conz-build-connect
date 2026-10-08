import { describe, expect, it } from "vitest";
import { parseNativeOAuthCallback } from "@/lib/oauth-callback-url";

describe("parseNativeOAuthCallback (audit H8)", () => {
  it("extracts a PKCE code", () => {
    expect(
      parseNativeOAuthCallback("com.conz.app://oauth-callback?code=0b1c2d3e-4f5a-6b7c-8d9e"),
    ).toEqual({
      kind: "code",
      code: "0b1c2d3e-4f5a-6b7c-8d9e",
    });
  });

  it("refuses redirects that carry tokens (implicit flow)", () => {
    expect(
      parseNativeOAuthCallback(
        "com.conz.app://oauth-callback#access_token=eyJ.abc&refresh_token=r1&token_type=bearer",
      ).kind,
    ).toBe("tokens_refused");
    expect(parseNativeOAuthCallback("com.conz.app://oauth-callback?access_token=x").kind).toBe(
      "tokens_refused",
    );
  });

  it("reports provider errors", () => {
    expect(
      parseNativeOAuthCallback(
        "com.conz.app://oauth-callback?error=access_denied&error_description=User+cancelled",
      ),
    ).toEqual({
      kind: "error",
      message: "User cancelled",
    });
  });

  it("ignores other URLs and malformed codes", () => {
    expect(parseNativeOAuthCallback("https://evil.com/?code=abcdefgh").kind).toBe("ignored");
    expect(parseNativeOAuthCallback("com.conz.app://other?code=abcdefgh").kind).toBe("ignored");
    expect(parseNativeOAuthCallback("com.conz.app://oauth-callback?code=<script>").kind).toBe(
      "ignored",
    );
  });
});
