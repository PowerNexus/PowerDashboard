-- Marque blanche d'un revendeur, et son domaine propre.
--
-- Une ligne par revendeur, créée à la première personnalisation. L'absence de
-- ligne n'est pas un défaut : elle veut dire « ce revendeur emploie la marque
-- de la plateforme », qui reste le cas le plus courant.
create table if not exists "reseller_brandings" (
  "id" uuid primary key default gen_random_uuid(),
  "user_id" uuid not null unique references "users"("id") on delete cascade,

  -- Ce qui remplace la marque de la plateforme. Tout est facultatif : une
  -- valeur vide fait retomber sur celle de la plateforme, champ par champ,
  -- plutôt que d'imposer de tout renseigner pour changer une couleur.
  "name" varchar(120) not null default '',
  "logo_url" text not null default '',
  "favicon_url" text not null default '',
  "accent" varchar(9) not null default '',
  "support_url" text not null default '',
  "terms_url" text not null default '',
  "footer_text" varchar(255) not null default '',
  "login_tagline" varchar(255) not null default '',

  -- Domaine propre. Unique : deux revendeurs ne peuvent pas revendiquer le
  -- même nom, et c'est lui qui décide de la marque servie à une requête.
  "domain" varchar(255) unique,
  -- Jeton de preuve de possession, publié en TXT sur `_gamedashboard.<domaine>`.
  "domain_token" varchar(64),
  -- Non nul quand les deux vérifications ont abouti : possession **et**
  -- acheminement. Tant qu'il est nul, le domaine n'est servi à personne.
  "domain_verified_at" timestamptz,
  "domain_checked_at" timestamptz,
  -- Dernier motif d'échec, en clair : « CNAME absent » et « TXT introuvable »
  -- ne se corrigent pas au même endroit.
  "domain_failure" text,

  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

-- La résolution par domaine est faite à chaque requête entrante : elle doit
-- porter sur un index, et ne jamais rendre un domaine non vérifié.
create index if not exists "reseller_branding_domain_idx"
  on "reseller_brandings" ("domain") where "domain_verified_at" is not null;
