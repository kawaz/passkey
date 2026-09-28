// oxlint-disable-next-line no-unused-expressions -- a snippet for `playwright-cli run-code`, which calls it with the page
async (page) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });
  const out = {};
  out.environment = await page.evaluate(() => window.check.environment());
  out.register = await page.evaluate(() => window.check.register());
  await page.evaluate((id) => {
    window.check.lastId = id;
  }, out.register.json.id);
  out.registerAgain = await page.evaluate(() => window.check.registerAgain());
  out.authenticate = await page.evaluate(() => window.check.authenticate());
  out.credentials = (
    await cdp.send("WebAuthn.getCredentials", { authenticatorId })
  ).credentials.map((c) => ({
    credentialId: c.credentialId,
    isResidentCredential: c.isResidentCredential,
    rpId: c.rpId,
    userHandle: c.userHandle,
    signCount: c.signCount,
  }));
  return JSON.stringify(out, null, 2);
};
