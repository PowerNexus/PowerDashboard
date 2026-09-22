import { Module } from "@nestjs/common";
import { databaseProvider } from "../../common/database.provider";
import { PlatformSettingsService } from "../admin/platform-settings.service";
import { WingsModule } from "../wings/wings.module";
import { CurseForgeClient } from "./curseforge.client";
import { EngineService } from "./engine.service";
import { EngineSourcesService } from "./engine-sources";
import { EulaService } from "./eula.service";
import { MarketplaceService } from "./marketplace.service";
import { ModpackSourceService } from "./modpack-source";
import { ModrinthClient } from "./modrinth.client";
import { SpigetClient } from "./spiget.client";

/**
 * Catalogue et moteur.
 *
 * Deux services voisins, et la frontière entre eux est celle de la nature du
 * serveur. `MarketplaceService` **ajoute** à un serveur — un plugin, un mod —
 * sans qu'il cesse d'être ce qu'il est. `EngineService` **remplace** ce qu'il
 * est : une plateforme de serveur, ou un modpack entier.
 *
 * Le catalogue interroge trois sources et tolère qu'une tombe :
 *
 * - **Modrinth**, sans clé — c'est pourquoi elle est venue en premier : une
 *   intégration sans secret est une intégration qui ne peut pas fuiter ;
 * - **CurseForge**, qui exige une clé et reste muette tant qu'elle n'est pas
 *   configurée — mais le dit, au lieu de rendre une liste vide ;
 * - **SpigotMC** par Spiget, sans clé, pour les plugins Bukkit historiques que
 *   les deux autres ne portent pas.
 *
 * Le moteur en interroge deux, sans clé également : les éditeurs de
 * plateformes (PaperMC, PurpurMC, FabricMC, Mojang) et les modpacks Modrinth.
 */
@Module({
  imports: [WingsModule],
  providers: [
    databaseProvider,
    MarketplaceService,
    // CurseForge lit sa clé dans les réglages : sans ce fournisseur, le module
    // ne démarre pas — et le typecheck ne voit rien du câblage de Nest.
    PlatformSettingsService,
    ModrinthClient,
    CurseForgeClient,
    SpigetClient,
    EngineService,
    EngineSourcesService,
    ModpackSourceService,
    EulaService,
  ],
  exports: [MarketplaceService, EngineService, EulaService],
})
export class MarketplaceModule {}
