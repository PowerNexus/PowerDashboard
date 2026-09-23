import { describe, expect, it } from "vitest";
import {
  assessSignIn,
  deviceFamily,
  isTrustedPeer,
  networkOf,
  trustedCountry,
} from "./sign-in-origin";

const FIREFOX_WINDOWS_130 =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0";
const FIREFOX_WINDOWS_131 =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";

describe("deviceFamily", () => {
  it("ignore la version : une mise à jour du navigateur n'est pas un nouvel appareil", () => {
    expect(deviceFamily(FIREFOX_WINDOWS_130)).toBe(deviceFamily(FIREFOX_WINDOWS_131));
    expect(deviceFamily(FIREFOX_WINDOWS_130)).toBe("Firefox/Windows");
  });

  it("distingue un autre navigateur ou un autre système", () => {
    expect(deviceFamily(CHROME_ANDROID)).toBe("Chrome/Android");
    expect(deviceFamily(CHROME_ANDROID)).not.toBe(deviceFamily(FIREFOX_WINDOWS_130));
  });

  it("range l'agent absent sous « inconnu »", () => {
    expect(deviceFamily(null)).toBe("unknown");
    expect(deviceFamily("node")).toBe("unknown");
  });
});

describe("networkOf", () => {
  it("ramène une IPv4 à son /24", () => {
    expect(networkOf("203.0.113.7")).toBe("203.0.113.0/24");
    expect(networkOf("203.0.113.250")).toBe("203.0.113.0/24");
    expect(networkOf("203.0.114.7")).not.toBe(networkOf("203.0.113.7"));
  });

  it("traite une IPv4 encapsulée comme l'IPv4 qu'elle porte", () => {
    expect(networkOf("::ffff:203.0.113.7")).toBe("203.0.113.0/24");
  });

  it("ramène une IPv6 à son /48, quelle que soit l'écriture", () => {
    expect(networkOf("2001:db8:abcd:12::1")).toBe("2001:db8:abcd::/48");
    expect(networkOf("2001:0db8:abcd:0099:0000:0000:0000:0001")).toBe("2001:db8:abcd::/48");
    expect(networkOf("2001:db8::1")).toBe("2001:db8:0::/48");
    expect(networkOf("2001:db8:abce::1")).not.toBe(networkOf("2001:db8:abcd::1"));
  });

  it("rend null pour une adresse absente ou illisible", () => {
    expect(networkOf(null)).toBeNull();
    expect(networkOf("pas une adresse")).toBeNull();
  });
});

describe("isTrustedPeer", () => {
  it("croit les adresses, blocs et noms de plage de TRUSTED_PROXIES", () => {
    expect(isTrustedPeer("127.0.0.1", "127.0.0.1, ::1")).toBe(true);
    expect(isTrustedPeer("::ffff:127.0.0.1", "127.0.0.1, ::1")).toBe(true);
    expect(isTrustedPeer("::1", "127.0.0.1, ::1")).toBe(true);
    expect(isTrustedPeer("10.1.2.3", "10.0.0.0/8")).toBe(true);
    expect(isTrustedPeer("127.0.0.5", "loopback")).toBe(true);
  });

  it("refuse tout le reste", () => {
    expect(isTrustedPeer("203.0.113.9", "127.0.0.1, ::1")).toBe(false);
    expect(isTrustedPeer(undefined, "127.0.0.1")).toBe(false);
    expect(isTrustedPeer("127.0.0.1", "")).toBe(false);
  });
});

describe("trustedCountry", () => {
  const headers = { "cf-ipcountry": "de" };

  it("lit le pays quand la requête vient d'un intermédiaire de confiance", () => {
    expect(trustedCountry(headers, "127.0.0.1", "127.0.0.1, ::1")).toBe("DE");
  });

  it("l'ignore quand l'API est jointe par un autre", () => {
    // Joint directement, l'API recevrait le pays que l'appelant a choisi.
    expect(trustedCountry(headers, "203.0.113.9", "127.0.0.1, ::1")).toBeNull();
  });

  it("ne prétend pas connaître un pays inconnu ou qui n'en est pas un", () => {
    expect(trustedCountry({}, "127.0.0.1", "127.0.0.1")).toBeNull();
    expect(trustedCountry({ "cf-ipcountry": "XX" }, "127.0.0.1", "127.0.0.1")).toBeNull();
    expect(trustedCountry({ "cf-ipcountry": "T1" }, "127.0.0.1", "127.0.0.1")).toBeNull();
  });
});

describe("assessSignIn", () => {
  const home = { device: "Firefox/Windows", network: "203.0.113.0/24" };

  it("se tait à la toute première connexion d'un compte", () => {
    expect(assessSignIn([], [], { ...home, country: null })).toBe("first");
  });

  it("reconnaît un couple appareil + réseau déjà vu", () => {
    expect(assessSignIn([home], [], { ...home, country: null })).toBe("known");
  });

  it("signale un nouvel appareil sur un réseau connu, et l'inverse", () => {
    expect(assessSignIn([home], [], { ...home, device: "Chrome/Android", country: null })).toBe(
      "new",
    );
    expect(assessSignIn([home], [], { ...home, network: "198.51.100.0/24", country: null })).toBe(
      "new",
    );
  });

  it("exige le couple : appareil vu ailleurs et réseau vu avec un autre ne suffisent pas", () => {
    const history = [home, { device: "Chrome/Android", network: "198.51.100.0/24" }];
    expect(
      assessSignIn(history, [], { device: "Chrome/Android", network: home.network, country: null }),
    ).toBe("new");
  });

  it("traite un nouveau pays comme nouveau", () => {
    expect(assessSignIn([home], ["FR"], { ...home, country: "DE" })).toBe("new");
    expect(assessSignIn([home], ["FR"], { ...home, country: "FR" })).toBe("known");
  });

  it("n'invente pas de nouveau pays quand aucun n'a encore été vu", () => {
    // Le jour où l'en-tête apparaît, personne n'a d'historique de pays.
    expect(assessSignIn([home], [], { ...home, country: "FR" })).toBe("known");
  });
});
