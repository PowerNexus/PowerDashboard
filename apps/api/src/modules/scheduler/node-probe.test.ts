import {
  NODE_HEARTBEAT_INTERVAL_MS,
  NODE_HEARTBEAT_LOST_MS,
  NODE_HEARTBEAT_STALE_MS,
} from "@gamedashboard/contracts";
import { describe, expect, it } from "vitest";
import { PROBE_SILENCE_MS, PROBE_TICK_MS } from "./node-probe.service";

/**
 * La sonde doit parler plus souvent que l'écran ne conclut.
 *
 * Défaut constaté sur la bêta : la sonde tournait à la minute pendant que le
 * seuil de retard était à trente secondes. Le node passait donc « en retard »
 * entre deux tours, en permanence, alors que le panel venait de lui parler et
 * qu'il répondait parfaitement. Une supervision qui crie au loup à chaque
 * respiration finit par n'être plus lue.
 *
 * Ces deux valeurs vivent dans des fichiers différents — le contrat pour les
 * seuils, le planificateur pour la cadence — et rien ne les faisait se
 * rencontrer. C'est ce que ce test répare : ajuster l'une sans l'autre échoue
 * ici, et non en production trois semaines plus tard.
 */
describe("cadence de la sonde face aux seuils d'état", () => {
  it("reprend son souffle avant que l'écran ne conclue au retard", () => {
    // Au pire : un node répond juste avant qu'on le juge silencieux, et le tour
    // suivant arrive un cycle complet plus tard. L'âge atteint alors la somme.
    expect(PROBE_SILENCE_MS + PROBE_TICK_MS).toBeLessThan(NODE_HEARTBEAT_STALE_MS);
  });

  it("laisse une marge confortable avant de conclure à l'injoignabilité", () => {
    // Le seuil de perte est bien plus lointain, mais la relation doit tenir :
    // un node déclaré injoignable alors qu'on le sonde toutes les dix secondes
    // signalerait une vraie panne, et c'est ce qu'on veut.
    expect(PROBE_SILENCE_MS + PROBE_TICK_MS).toBeLessThan(NODE_HEARTBEAT_LOST_MS);
  });

  it("ne sonde pas plus vite que le rythme attendu d'un node", () => {
    /*
     * L'autre bord : une sonde deux fois plus rapide que nécessaire doublerait
     * les requêtes sortantes et les écritures, sans rien apprendre de plus.
     *
     * La borne est le **rythme attendu**, pas le seuil de retard. Les deux ne
     * disent pas la même chose : le rythme est la fréquence à laquelle on veut
     * des nouvelles, le seuil est le nombre de tours manqués qu'on tolère avant
     * de s'en inquiéter. Adosser cette borne au seuil faisait qu'élargir la
     * tolérance — pour cesser d'annoncer « en retard » un node qu'on venait
     * d'entendre — exigeait aussi de sonder moins souvent, ce qui n'a aucun
     * rapport.
     */
    expect(PROBE_TICK_MS).toBeGreaterThanOrEqual(NODE_HEARTBEAT_INTERVAL_MS);
  });
});
