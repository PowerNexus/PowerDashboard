import { describe, expect, it } from "vitest";
import {
  acceptsExplicitResources,
  attributedReseller,
  checkQuota,
  checkQuotaGrowth,
  checkResources,
  choosesNode,
  choosesOwner,
  provisioningMode,
  type QuotaUsage,
  quotaOutlook,
  quotaRatio,
  RESOURCE_BOUNDS,
  type ResellerQuota,
  type ResourceRequest,
  UNLIMITED_QUOTA,
} from "./provisioning";

const VALID: ResourceRequest = {
  memoryMb: 4096,
  diskMb: 25_600,
  cpuPct: 200,
  swapMb: 0,
  allocations: 2,
  backups: 5,
  databases: 2,
};

describe("provisioningMode", () => {
  it("donne un mode par rôle", () => {
    expect(provisioningMode("admin")).toBe("advanced");
    expect(provisioningMode("reseller")).toBe("assisted");
    expect(provisioningMode("user")).toBe("guided");
  });

  it("retombe sur le mode le plus fermé pour un rôle inconnu", () => {
    // Un rôle ajouté demain ne doit pas hériter des pleins pouvoirs parce que
    // personne n'a pensé à l'inscrire ici.
    for (const role of ["support", "", "superadmin", "RESELLER"]) {
      expect(provisioningMode(role)).toBe("guided");
    }
  });
});

describe("capacités par mode", () => {
  it("n'accepte de quantités explicites que hors du mode guidé", () => {
    expect(acceptsExplicitResources("guided")).toBe(false);
    expect(acceptsExplicitResources("assisted")).toBe(true);
    expect(acceptsExplicitResources("advanced")).toBe(true);
  });

  it("laisse désigner un propriétaire à qui héberge, pas au client", () => {
    /*
     * Le mode assisté l'a rejoint, et ce n'est pas un relâchement : un
     * revendeur qui ne peut pas créer pour un client n'est pas un hébergeur.
     * Il fallait passer par sa boutique, donc en avoir une.
     *
     * Les deux modes ne donnent pas le même pouvoir pour autant — c'est
     * `resolveOwner` qui les sépare : l'administrateur sert qui il veut, le
     * revendeur seulement un compte libre ou déjà sien. Cette fonction-ci ne
     * dit que « le formulaire peut-il proposer un destinataire ».
     */
    expect(choosesOwner("guided")).toBe(false);
    expect(choosesOwner("assisted")).toBe(true);
    expect(choosesOwner("advanced")).toBe(true);
  });

  it("laisse choisir le node hors du mode guidé", () => {
    expect(choosesNode("guided")).toBe(false);
    expect(choosesNode("assisted")).toBe(true);
  });
});

describe("checkResources", () => {
  it("accepte une demande cohérente", () => {
    expect(checkResources(VALID)).toEqual([]);
  });

  it("refuse une mémoire sous le plancher", () => {
    const problems = checkResources({ ...VALID, memoryMb: 64 });
    expect(problems).toContainEqual({
      kind: "out-of-bounds",
      resource: "memoryMb",
      min: RESOURCE_BOUNDS.memoryMb.min,
      max: RESOURCE_BOUNDS.memoryMb.max,
    });
  });

  it("refuse une valeur négative ou démesurée", () => {
    expect(checkResources({ ...VALID, diskMb: -1 })).toHaveLength(1);
    expect(checkResources({ ...VALID, memoryMb: 10 ** 9 })).toHaveLength(1);
  });

  it("refuse une valeur fractionnaire", () => {
    // Une mémoire de 2048,5 Mo n'a pas de sens pour Docker, et arrondir en
    // silence enregistrerait autre chose que ce qui a été saisi.
    expect(checkResources({ ...VALID, memoryMb: 2048.5 })).toEqual([
      { kind: "not-integer", resource: "memoryMb" },
    ]);
  });

  /**
   * Zéro signifie « sans limite » dans Wings, pas « aucun processeur ». Le
   * refuser interdirait une configuration parfaitement valide, et courante sur
   * un node dédié à un seul serveur.
   */
  it("accepte un processeur à zéro, qui vaut « sans limite »", () => {
    expect(checkResources({ ...VALID, cpuPct: 0 })).toEqual([]);
  });

  it("refuse tout de même un processeur négatif", () => {
    expect(checkResources({ ...VALID, cpuPct: -50 })).toHaveLength(1);
  });

  it("accepte un swap à -1, qui vaut « illimité » côté Docker", () => {
    expect(checkResources({ ...VALID, swapMb: -1 })).toEqual([]);
  });

  it("cumule les manquements plutôt que de s'arrêter au premier", () => {
    // Corriger la mémoire pour se voir opposer le disque au coup suivant
    // ferait deviner les règles par tâtonnement.
    const problems = checkResources({ ...VALID, memoryMb: 0, diskMb: 0, backups: -3 });
    expect(problems.map((p) => p.resource).sort()).toEqual(["backups", "diskMb", "memoryMb"]);
  });

  it("exige au moins un port", () => {
    // Sans port, un serveur n'a pas d'adresse et ne peut pas exister.
    expect(checkResources({ ...VALID, allocations: 0 })).toHaveLength(1);
  });
});

describe("checkQuota", () => {
  const EMPTY = { memoryMb: 0, diskMb: 0, servers: 0 };
  const QUOTA: ResellerQuota = { memoryMb: 32_768, diskMb: 512_000, serversMax: 20 };

  it("ne borne rien quand aucune enveloppe n'est posée", () => {
    // Le cas de tous les revendeurs le jour où la fonctionnalité arrive :
    // aucune ligne en base. Interpréter cette absence comme un zéro les
    // bloquerait tous à la première création.
    const usage = { memoryMb: 900_000, diskMb: 9_000_000, servers: 400 };
    expect(checkQuota(UNLIMITED_QUOTA, usage, { memoryMb: 4096, diskMb: 25_600 })).toEqual([]);
  });

  it("accepte une demande qui remplit exactement l'enveloppe", () => {
    // Un plafond de 32 Go doit permettre d'allouer 32 Go, sinon ce n'est pas
    // le plafond annoncé.
    const usage = { ...EMPTY, memoryMb: 28_672 };
    expect(checkQuota(QUOTA, usage, { memoryMb: 4096, diskMb: 1024 })).toEqual([]);
  });

  it("refuse le mégaoctet de trop", () => {
    const usage = { ...EMPTY, memoryMb: 32_768 };
    const problems = checkQuota(QUOTA, usage, { memoryMb: 1, diskMb: 1024 });
    expect(problems).toEqual([
      { kind: "quota-exceeded", dimension: "memoryMb", limit: 32_768, used: 32_768, requested: 1 },
    ]);
  });

  it("compte le serveur demandé dans le décompte de serveurs", () => {
    // Le plafond porte sur le résultat de la création, pas sur son point de
    // départ : à 20/20, le vingt-et-unième est refusé.
    const usage = { ...EMPTY, servers: 20 };
    const problems = checkQuota(QUOTA, usage, { memoryMb: 1024, diskMb: 1024 });
    expect(problems.map((p) => p.dimension)).toEqual(["servers"]);
  });

  it("énumère tous les dépassements d'un coup", () => {
    const usage = { memoryMb: 32_768, diskMb: 512_000, servers: 20 };
    const problems = checkQuota(QUOTA, usage, { memoryMb: 1024, diskMb: 1024 });
    expect(problems.map((p) => p.dimension)).toEqual(["memoryMb", "diskMb", "servers"]);
  });

  it("laisse vivre un revendeur déjà au-delà, mais lui interdit d'ajouter", () => {
    // Réduire une enveloppe est une décision commerciale ; elle ne doit pas
    // se traduire par une extinction de serveurs en cours.
    const usage = { memoryMb: 65_536, diskMb: 0, servers: 3 };
    expect(checkQuota(QUOTA, usage, { memoryMb: 1024, diskMb: 1024 })).toHaveLength(1);
  });

  it("interdit toute création sous une enveloppe à zéro", () => {
    // Zéro est une valeur qu'on pose sciemment, à la différence de `null`.
    const zero: ResellerQuota = { memoryMb: 0, diskMb: 0, serversMax: 0 };
    expect(checkQuota(zero, EMPTY, { memoryMb: 1024, diskMb: 1024 })).toHaveLength(3);
  });
});

describe("quotaRatio", () => {
  it("rend null pour une dimension sans limite", () => {
    // Une jauge sans plafond n'a pas de remplissage : inventer 0 ou 100 %
    // ferait croire à une limite qui n'existe pas.
    expect(quotaRatio(null, 4096)).toBeNull();
  });

  it("plafonne à 1 au-delà de l'enveloppe", () => {
    expect(quotaRatio(1000, 2500)).toBe(1);
  });

  it("considère une enveloppe nulle comme pleine", () => {
    expect(quotaRatio(0, 0)).toBe(1);
  });

  it("rend la part consommée", () => {
    expect(quotaRatio(1000, 250)).toBe(0.25);
  });
});

describe("attributedReseller", () => {
  const PLATEFORME = { role: "admin", id: "application:platform" };

  it("rattache à lui-même le revendeur qui provisionne, y compris sur une part", () => {
    // Sur une tranche d'une machine de la plateforme, le node n'est à personne
    // — c'est le nôtre — mais la part est la sienne. Lire le propriétaire du
    // node rendrait `null`, et sa part ne compterait jamais rien.
    expect(attributedReseller({ role: "reseller", id: "rev-1", nodeOwnerId: null })).toBe("rev-1");
  });

  it("rattache au revendeur la commande passée par sa boutique", () => {
    // Le demandeur est la plateforme — c'est elle qui a le droit de choisir le
    // destinataire — mais le serveur est celui du revendeur.
    expect(attributedReseller({ ...PLATEFORME, onBehalfOf: "rev-2", nodeOwnerId: null })).toBe(
      "rev-2",
    );
  });

  it("rattache au revendeur ce que l'administration pose sur sa machine", () => {
    // Même règle que le quota, qui oppose déjà le plafond du propriétaire du
    // node : ce qu'on lui refuse doit être ce qu'on lui compte.
    expect(attributedReseller({ ...PLATEFORME, nodeOwnerId: "rev-3" })).toBe("rev-3");
  });

  it("laisse à la plateforme ce qu'elle crée sur son propre matériel", () => {
    expect(attributedReseller({ ...PLATEFORME, nodeOwnerId: null })).toBeNull();
    expect(attributedReseller({ role: "user", id: "client-1", nodeOwnerId: null })).toBeNull();
  });

  it("fait primer la boutique sur le propriétaire de la machine", () => {
    // Un revendeur qui a une part sur la machine d'un autre revendeur : le
    // serveur est vendu par lui, pas par le propriétaire du fer.
    expect(attributedReseller({ ...PLATEFORME, onBehalfOf: "rev-4", nodeOwnerId: "rev-5" })).toBe(
      "rev-4",
    );
  });
});

describe("quotaOutlook", () => {
  const ENVELOPPE: ResellerQuota = { memoryMb: 1024, diskMb: 10_240, serversMax: 5 };
  const CALME: QuotaUsage = { memoryMb: 512, diskMb: 5120, servers: 2 };

  it("ne signale rien sous le plafond", () => {
    expect(quotaOutlook(ENVELOPPE, CALME, "measured")).toBe("under");
  });

  it("ne signale rien quand aucune dimension n'est limitée", () => {
    // Une enveloppe vide n'est pas une enveloppe pleine : c'est l'état de tout
    // revendeur à qui l'on n'a rien fixé.
    expect(
      quotaOutlook(UNLIMITED_QUOTA, { memoryMb: 99_999, diskMb: 99_999, servers: 99 }, "measured"),
    ).toBe("under");
  });

  it("distingue atteint de dépassé", () => {
    // Au plafond exact, rien n'est coupé : seule la création s'arrête. Annoncer
    // une coupure ici ferait arrêter des serveurs par précaution, pour rien.
    expect(quotaOutlook(ENVELOPPE, { ...CALME, memoryMb: 1024 }, "measured")).toBe("full");
  });

  it("annonce la coupure quand la mémoire est dépassée et mesurée", () => {
    expect(quotaOutlook(ENVELOPPE, { ...CALME, memoryMb: 2048 }, "measured")).toBe("over-enforced");
  });

  it("n'annonce aucune coupure quand la mesure manque", () => {
    /*
     * Le cas où l'écran mentirait le plus : la consommation est majorée par les
     * limites accordées, donc au-dessus du réel, et le surveillant refuse
     * d'agir dessus. Promettre une coupure ferait attendre un événement qui
     * n'arrivera jamais.
     */
    expect(quotaOutlook(ENVELOPPE, { ...CALME, memoryMb: 2048 }, "estimated")).toBe(
      "over-unmeasured",
    );
    // Partiellement mesurée compte comme estimée : une seule machine sans
    // relevé suffit à fausser la somme, et on ne sait pas dire laquelle.
    expect(quotaOutlook(ENVELOPPE, { ...CALME, memoryMb: 2048 }, "partial")).toBe(
      "over-unmeasured",
    );
  });

  it("n'annonce aucune coupure pour le disque ni pour le nombre", () => {
    // Arrêter un serveur rend de la mémoire ; cela ne rend pas un octet de
    // disque, ni ne fait disparaître un serveur. Rien n'est donc coupé.
    expect(quotaOutlook(ENVELOPPE, { ...CALME, diskMb: 99_999 }, "measured")).toBe("over-passive");
    expect(quotaOutlook(ENVELOPPE, { ...CALME, servers: 9 }, "measured")).toBe("over-passive");
  });

  it("fait primer la coupure à venir sur le reste", () => {
    // Dépasser la mémoire **et** le disque n'annonce qu'une chose : la
    // coupure. C'est la seule qui demande un geste dans l'heure.
    expect(
      quotaOutlook(ENVELOPPE, { memoryMb: 2048, diskMb: 99_999, servers: 9 }, "measured"),
    ).toBe("over-enforced");
  });
});

/**
 * Agrandir un serveur n'est pas en créer un.
 *
 * Rien ne pouvait changer les limites d'un serveur existant : une montée en
 * gamme passait par « supprimer et recréer », c'est-à-dire par la perte du
 * monde du client. En ouvrant ce chemin, le quota devait apprendre à compter
 * un agrandissement — et surtout à ne pas le compter comme une création.
 */
describe("checkQuotaGrowth", () => {
  const EMPTY = { memoryMb: 0, diskMb: 0, servers: 0 };
  const QUOTA: ResellerQuota = { memoryMb: 32_768, diskMb: 512_000, serversMax: 20 };

  it("ne bute pas sur le plafond du nombre de serveurs", () => {
    // Le cœur de la distinction. Un revendeur au complet — vingt serveurs sur
    // vingt — doit pouvoir faire monter un client en gamme. Compter un serveur
    // de plus le forcerait à en supprimer un pour agrandir l'autre.
    const usage = { memoryMb: 8192, diskMb: 51_200, servers: 20 };
    expect(checkQuotaGrowth(QUOTA, usage, { memoryMb: 2048, diskMb: 0, servers: 0 })).toEqual([]);
  });

  it("refuse encore une création quand le nombre est atteint", () => {
    // L'autre moitié : la distinction ne doit pas ouvrir la création.
    const usage = { memoryMb: 8192, diskMb: 51_200, servers: 20 };
    const problems = checkQuotaGrowth(QUOTA, usage, { memoryMb: 2048, diskMb: 0, servers: 1 });
    expect(problems.map((p) => p.dimension)).toEqual(["servers"]);
  });

  it("laisse toujours réduire, même au-delà du plafond", () => {
    /*
     * L'enfermement qu'il faut éviter : un revendeur dont l'enveloppe a été
     * abaissée se retrouve en dépassement. S'il ne peut pas rétrécir un
     * serveur, il n'a aucun moyen de revenir sous la limite qu'on lui oppose —
     * sinon supprimer le serveur d'un client.
     */
    const usage = { memoryMb: 40_000, diskMb: 600_000, servers: 25 };
    expect(
      checkQuotaGrowth(QUOTA, usage, { memoryMb: -4096, diskMb: -10_240, servers: 0 }),
    ).toEqual([]);
  });

  it("compte l'écart et non le total", () => {
    // Passer de 2 à 4 Go demande 2 Go. Compter 4 refuserait un agrandissement
    // que l'enveloppe permet.
    const usage = { ...EMPTY, memoryMb: 30_720 };
    expect(checkQuotaGrowth(QUOTA, usage, { memoryMb: 2048, diskMb: 0, servers: 0 })).toEqual([]);
    expect(checkQuotaGrowth(QUOTA, usage, { memoryMb: 2049, diskMb: 0, servers: 0 })).toHaveLength(
      1,
    );
  });

  it("rend exactement ce que rendait checkQuota pour une création", () => {
    // `checkQuota` est maintenant écrit par-dessus celui-ci : les deux doivent
    // coïncider, sinon la création aurait silencieusement changé de règle.
    const usage = { memoryMb: 30_000, diskMb: 500_000, servers: 19 };
    const demande = { memoryMb: 4096, diskMb: 25_600 };
    expect(checkQuota(QUOTA, usage, demande)).toEqual(
      checkQuotaGrowth(QUOTA, usage, { ...demande, servers: 1 }),
    );
  });
});
