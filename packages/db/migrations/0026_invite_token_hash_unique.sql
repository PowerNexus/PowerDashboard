CREATE UNIQUE INDEX "invite_token_hash_unique" ON "server_invites" USING btree ("token_hash");
