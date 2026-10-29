import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { type EmailMessage, emailMessageSchema } from "@anar/domain/jobs";

export function createMailCodec(encodedKey: string) {
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) throw new Error("Mail key must contain 32 bytes");
  return {
    encryptMessage(message: EmailMessage, deliveryKey: string): string {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(Buffer.from(deliveryKey));
      const encrypted = Buffer.concat([
        cipher.update(
          JSON.stringify(emailMessageSchema.parse(message)),
          "utf8",
        ),
        cipher.final(),
      ]);
      return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString(
        "base64url",
      );
    },
    decryptMessage(value: string, deliveryKey: string): EmailMessage {
      try {
        const encoded = Buffer.from(value, "base64url");
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          encoded.subarray(0, 12),
        );
        decipher.setAAD(Buffer.from(deliveryKey));
        decipher.setAuthTag(encoded.subarray(12, 28));
        const plaintext = Buffer.concat([
          decipher.update(encoded.subarray(28)),
          decipher.final(),
        ]).toString("utf8");
        return emailMessageSchema.parse(JSON.parse(plaintext));
      } catch {
        throw new Error("Invalid encrypted mail");
      }
    },
  };
}
