// oxlint-disable-next-line no-unused-expressions -- a snippet for `playwright-cli run-code`, which calls it with the page
async (page) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });
  const out = {};
  out.register = (await page.evaluate(() => window.check.register())).server.ok;
  out.start = await page.evaluate(() => window.check.startConditional());
  await page.locator("#username").click();
  out.conditional = await page.evaluate(() =>
    Promise.race([
      window.check.conditional,
      new Promise((r) => setTimeout(() => r("still pending after 3s"), 3000)),
    ]),
  );
  if (out.conditional === "still pending after 3s") {
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    out.afterKeys = await page.evaluate(() =>
      Promise.race([
        window.check.conditional,
        new Promise((r) => setTimeout(() => r("still pending after keys"), 3000)),
      ]),
    );
  }
  out.abortStart = await page.evaluate(() => window.check.startConditional());
  out.aborted = await page.evaluate(() => {
    window.check.controller.abort();
    return window.check.conditional;
  });
  return JSON.stringify(out, null, 2);
};
