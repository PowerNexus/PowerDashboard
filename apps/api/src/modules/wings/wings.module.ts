import { Module } from "@nestjs/common";
import { databaseProvider } from "../../common/database.provider";
import { WingsClientService } from "./wings-client.service";
import { WingsTokenService } from "./wings-token.service";

@Module({
  providers: [databaseProvider, WingsClientService, WingsTokenService],
  exports: [WingsClientService, WingsTokenService],
})
export class WingsModule {}
