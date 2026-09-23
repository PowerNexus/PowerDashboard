import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { battre } from "../../common/background-tick";
import { ServerTransferService } from "./server-transfer.service";

/**
 * Cinq minutes : un transfert perdu est déclaré au bout de deux heures, le
 * balayage n'a pas besoin d'être plus précis que cela.
 */
const TICK_MS = 5 * 60_000;

/**
 * Balayage des transferts perdus (`ServerTransferService.expireStale`).
 *
 * Vit dans le module d'administration, à côté du service qu'il appelle, et
 * non dans celui du planificateur : l'administration importe déjà le
 * planificateur, l'inverse formerait un cycle.
 */
@Injectable()
export class ServerTransferReaperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ServerTransferReaperService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(@Inject(ServerTransferService) private readonly transfers: ServerTransferService) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () =>
        battre(this.logger, "transferts perdus", async () => {
          await this.transfers.expireStale();
        }),
      TICK_MS,
    );
    // Ce minuteur ne doit pas empêcher le processus de s'arrêter.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
