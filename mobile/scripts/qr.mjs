#!/usr/bin/env node
/**
 * Prints the Doppel server address as a QR code for the app's "Scan QR code" button.
 *
 *   npm run qr                              this computer's LAN address, port 3000
 *   npm run qr -- 3410                      this computer's LAN address, another port
 *   npm run qr -- http://192.168.1.20:3000  exactly this address (e.g. a tunnel URL)
 */
import { networkInterfaces } from "node:os";
import qrcode from "qrcode-terminal";

const argument = process.argv[2] ?? "3000";

/** IPv4 addresses a phone on the same network can reach, private ranges first. */
function lanAddresses() {
  const found = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === "IPv4" && !net.internal && !net.address.startsWith("169.254.")) found.push(net.address);
    }
  }
  const isPrivate = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  return found.sort((a, b) => Number(isPrivate(b)) - Number(isPrivate(a)));
}

let addresses;
if (/^\d+$/.test(argument)) {
  addresses = lanAddresses().map((ip) => `http://${ip}:${argument}`);
  if (addresses.length === 0) {
    console.error("No network address found. Connect this computer to Wi-Fi, or pass the address: npm run qr -- http://<host>:3000");
    process.exit(1);
  }
} else {
  addresses = [/^https?:\/\//i.test(argument) ? argument.replace(/\/+$/, "") : `http://${argument}`];
}

/** Same contract the app checks: GET <address>/api/twin answers { ok: true, configured: boolean }. */
async function check(address) {
  try {
    const response = await fetch(`${address}/api/twin`, { signal: AbortSignal.timeout(3000) });
    const body = await response.json();
    return body?.ok === true && typeof body.configured === "boolean" ? "Doppel answers here" : "answers, but is not Doppel";
  } catch {
    return "no answer from this computer (is Doppel running on that port?)";
  }
}

const address = addresses[0];
console.log(`\n${address}   ${await check(address)}\n`);
qrcode.generate(address, { small: true });
if (addresses.length > 1) {
  console.log("Other addresses of this computer (pass one to show its code):");
  for (const other of addresses.slice(1)) console.log(`  npm run qr -- ${other}`);
}
console.log("In the app: Scan QR code. The phone must be able to reach this address (same Wi-Fi, or a tunnel).\n");
