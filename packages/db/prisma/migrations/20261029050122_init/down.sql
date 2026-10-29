-- Reversão da migração init (destrutiva: apaga TODOS os dados do OpenCord). Fazer backup antes.
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
