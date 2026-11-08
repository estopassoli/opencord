-- Espaço 3D da chamada (ADR-0055): ambiente editado de cada servidor (paredes, área, móveis) em JSON validado pela API.
-- Servidor sem linha aqui usa o ambiente gerado a partir do próprio id. Aditivo.
-- Reversão: DROP TABLE "ServerSpace";
CREATE TABLE "ServerSpace" (
    "serverId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "layout" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "ServerSpace_pkey" PRIMARY KEY ("serverId")
);

ALTER TABLE "ServerSpace" ADD CONSTRAINT "ServerSpace_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
