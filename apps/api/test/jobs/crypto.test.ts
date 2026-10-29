import { createCipheriv, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createMailCodec } from "../../src/lib/email/crypto.js";

describe("encrypted mail", () => {
  const key = randomBytes(32);
  const codec = createMailCodec(key.toString("base64"));
  const message = {
    to: "recipient@example.test",
    subject: "Fixture",
    text: "Synthetic OTP 384205",
    html: "<p>Synthetic OTP 384205</p>",
  };
  const deliveryKey = "fixture-revision";

  it("round trips without exposing message fields and uses a fresh nonce", () => {
    const first = codec.encryptMessage(message, deliveryKey);
    expect(codec.decryptMessage(first, deliveryKey)).toEqual(message);
    expect(codec.encryptMessage(message, deliveryKey)).not.toBe(first);
    const persisted = Buffer.from(first, "base64url").toString("utf8");
    for (const value of Object.values(message))
      expect(persisted).not.toContain(value);
  });

  it.each([0, 12, 28])(
    "rejects changed nonce, tag or ciphertext at byte %i",
    (index) => {
      const value = Buffer.from(
        codec.encryptMessage(message, deliveryKey),
        "base64url",
      );
      value[index] ^= 1;
      expect(() =>
        codec.decryptMessage(value.toString("base64url"), deliveryKey),
      ).toThrow("Invalid encrypted mail");
    },
  );

  it("rejects a different key or delivery revision", () => {
    const value = codec.encryptMessage(message, deliveryKey);
    expect(() =>
      createMailCodec(randomBytes(32).toString("base64")).decryptMessage(
        value,
        deliveryKey,
      ),
    ).toThrow("Invalid encrypted mail");
    expect(() => codec.decryptMessage(value, "other-revision")).toThrow(
      "Invalid encrypted mail",
    );
  });

  it("rejects truncated envelopes and invalid decrypted content", () => {
    expect(() => codec.decryptMessage("short", deliveryKey)).toThrow(
      "Invalid encrypted mail",
    );
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(deliveryKey));
    const encrypted = Buffer.concat([
      cipher.update('{"invalid":true}'),
      cipher.final(),
    ]);
    const value = Buffer.concat([
      nonce,
      cipher.getAuthTag(),
      encrypted,
    ]).toString("base64url");
    expect(() => codec.decryptMessage(value, deliveryKey)).toThrow(
      "Invalid encrypted mail",
    );
  });
});
