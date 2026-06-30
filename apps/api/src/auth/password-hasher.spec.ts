import { PasswordHasher } from "./password-hasher";

describe("PasswordHasher", () => {
  const hasher = new PasswordHasher();

  beforeAll(async () => {
    await hasher.onModuleInit();
  });

  it("hashes to a non-plaintext argon2id string", async () => {
    const hash = await hasher.hash("correct horse battery staple");
    expect(hash).not.toBe("correct horse battery staple");
    expect(hash.startsWith("$argon2id$")).toBe(true);
  });

  it("verifies the correct password and rejects a wrong one", async () => {
    const hash = await hasher.hash("correct horse battery staple");
    await expect(
      hasher.verify(hash, "correct horse battery staple"),
    ).resolves.toBe(true);
    await expect(hasher.verify(hash, "wrong password")).resolves.toBe(false);
  });

  it("verifyAgainstDummy always returns false (timing equalizer)", async () => {
    await expect(hasher.verifyAgainstDummy("anything at all")).resolves.toBe(
      false,
    );
  });
});
