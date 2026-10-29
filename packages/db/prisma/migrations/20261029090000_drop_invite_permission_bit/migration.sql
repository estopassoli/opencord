-- ADR-0007: CREATE_INVITE (bit 17 = 131072) deixou de existir. Limpa o bit de cargos e overrides.
UPDATE "Role" SET "permissions" = "permissions" & ~131072 WHERE "permissions" & 131072 <> 0;
UPDATE "ChannelPermissionOverride" SET "allow" = "allow" & ~131072, "deny" = "deny" & ~131072
WHERE ("allow" | "deny") & 131072 <> 0;
