#!/usr/bin/env bash
#
# Crée un compte sur la production locale, par la vraie route d'inscription :
# c'est le code de l'application qui hache le mot de passe.
#
#   creer-compte.sh <email> <prénom> <nom> [admin]
#
# Les inscriptions sont fermées par défaut — on les ouvre le temps d'un appel
# et le `trap` les referme même si l'appel échoue.

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
API=http://127.0.0.1:3211
Q() { sudo -u postgres psql -d gamedashboard -tAqc "$1"; }

EMAIL=${1:?email attendu}
PRENOM=${2:-Client}
NOM=${3:-Local}
ROLE=${4:-user}

if [ -n "$(Q "select 1 from users where lower(email) = lower('$EMAIL')")" ]; then
  echo "  un compte existe déjà pour $EMAIL"
  exit 0
fi

ouvrir() {
  Q "insert into settings (key, value) values ('security.registrationOpen', '$1'::jsonb)
     on conflict (key) do update set value = '$1'::jsonb, updated_at = now()" >/dev/null
}
ouvrir true
trap 'ouvrir false' EXIT

# Aléatoire pur : la politique du panel refuse un mot de passe qui contient le
# nom ou l'adresse du compte, et elle a raison de le faire.
PASS=$(openssl rand -base64 24 | tr -d '/+=\n')

code=$(curl -s -o /tmp/compte.json -w '%{http_code}' -X POST \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"nameFirst\":\"$PRENOM\",\"nameLast\":\"$NOM\",\"password\":\"$PASS\"}" \
  "$API/api/v1/auth/register")

if [ "$code" = "200" ] || [ "$code" = "201" ]; then
  # Vérifié d'office : aucun courriel ne part d'une machine locale, et un
  # compte bloqué sur « confirmez votre adresse » ne sert à personne.
  Q "update users set email_verified_at = now() where lower(email) = lower('$EMAIL')" >/dev/null
  [ "$ROLE" = "user" ] || Q "update users set role = '$ROLE' where lower(email) = lower('$EMAIL')" >/dev/null
  echo
  printf '  identifiant  : %s\n' "$EMAIL"
  printf '  mot de passe : %s\n' "$PASS"
  printf '  rôle         : %s\n' "$(Q "select role from users where lower(email) = lower('$EMAIL')")"
  echo
  echo "  (affiché une seule fois — il n'est stocké nulle part en clair)"
else
  echo "  ÉCHEC ($code) : $(head -c 200 /tmp/compte.json)"
fi
rm -f /tmp/compte.json
ouvrir false
trap - EXIT
echo "  inscriptions : $(Q "select value::text from settings where key = 'security.registrationOpen'")"
