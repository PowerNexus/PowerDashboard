<?php

/**
 * Éprouve la logique du module, sans HostBill.
 *
 * HostBill est propriétaire et ne s'installe pas pour un essai. Ce banc en
 * simule donc la classe parente et le client d'API, puis vérifie ce qui
 * appartient en propre au module : **l'ordre des gestes et les refus**.
 *
 * Ce qu'il ne prouve pas, et il faut le dire : les noms sous lesquels HostBill
 * expose ses données (`$this->details`). Ils sont tous regroupés dans
 * `hostbillValue()` pour cette raison.
 *
 * Lancement : `php tests/module-logic.php` depuis `plugins/hostbill/`.
 */

require_once __DIR__ . '/../includes/GameDashboardClient.php';

/** Parent simulé : juste ce que le module appelle. */
abstract class HBServerModule
{
    public array $options = [];
    public array $details = [];
    public array $erreurs = [];
    private array $serviceDetails = [];

    protected function addError(string $message): void
    {
        $this->erreurs[] = $message;
    }

    protected function setServiceDetail(string $cle, string $valeur): void
    {
        $this->serviceDetails[$cle] = $valeur;
    }

    protected function getServiceDetail(string $cle): string
    {
        return $this->serviceDetails[$cle] ?? '';
    }
}

require_once __DIR__ . '/../class.gamedashboard.php';

/** Client simulé : enregistre les appels et rend ce que le scénario dicte. */
class ClientSimule extends GameDashboardClient
{
    public array $appels = [];
    public ?array $parExterne = null;
    public ?array $parEmail = null;

    public function __construct()
    {
        parent::__construct('https://panel.test', 'gd_app_test_secret');
    }

    public function findUserByExternalId(string $externalId): ?array
    {
        $this->appels[] = "findByExternal:{$externalId}";
        return $this->parExterne;
    }

    public function findUserByEmail(string $email): ?array
    {
        $this->appels[] = "findByEmail:{$email}";
        return $this->parEmail;
    }

    public function linkExternalId(string $userId, string $externalId): array
    {
        $this->appels[] = "link:{$userId}:{$externalId}";
        return ['data' => ['id' => $userId]];
    }

    public function createUser(
        string $email,
        string $firstName,
        string $lastName,
        string $externalId,
        ?string $idempotencyKey = null
    ): array {
        $this->appels[] = "createUser:{$externalId}:{$idempotencyKey}";
        return ['data' => ['id' => 'compte-neuf']];
    }

    public function createServer(array $payload, ?string $idempotencyKey = null): array
    {
        $this->appels[] = "createServer:{$payload['ownerId']}:{$idempotencyKey}";
        return ['data' => ['id' => 'serveur-42']];
    }

    public function setSuspended(string $serverId, bool $suspended, string $reason = ''): array
    {
        $this->appels[] = 'suspend:' . $serverId . ':' . ($suspended ? 'oui' : 'non');
        return [];
    }

    public function deleteServer(string $serverId): array
    {
        $this->appels[] = "delete:{$serverId}";
        if ($serverId === 'deja-parti') {
            throw new GameDashboardNotFound('Serveur introuvable.');
        }
        return [];
    }

    public function ssoLink(string $externalId): string
    {
        $this->appels[] = "ssoLink:{$externalId}";
        return 'https://panel.test/sso/jeton-a-usage-unique';
    }
}

/** Module sous banc : le seul remplacement est la fabrique du client. */
class ModuleSousBanc extends gamedashboard
{
    public ClientSimule $simule;
    public string $emailDuClient = 'paul@exemple.fr';

    protected function client(): GameDashboardClient
    {
        return $this->simule;
    }

    /**
     * `ApiWrapper` n'existe que dans HostBill : on rend ici ce qu'il aurait
     * rendu. Le banc peut aussi le vider, pour éprouver le refus.
     */
    protected function clientEmail(string $idClient): string
    {
        return $this->emailDuClient;
    }
}

function module(ClientSimule $simule): ModuleSousBanc
{
    $m = new ModuleSousBanc();
    $m->simule = $simule;
    /*
     * Les noms sont ceux que l'API HostBill documente pour un compte :
     * `id` pour le service, `client_id`, `firstname`, `lastname`, `domain`.
     *
     * **`email` n'y figure pas volontairement** : la documentation confirme
     * qu'il appartient à la fiche client, pas au compte. Si le module allait
     * le chercher ici, le banc échouerait — ce qu'il faisait.
     */
    $m->details = [
        'client_id' => '4271',
        'firstname' => 'Paul',
        'lastname' => 'Martin',
        'id' => '9001',
        'domain' => 'mon-serveur.exemple.fr',
    ];
    $m->options = [
        'Adresse du panel' => ['value' => 'https://panel.test'],
        'Clé applicative' => ['value' => 'gd_app_test_secret'],
        'Identifiant de l\'offre (egg)' => ['value' => 'egg-minecraft'],
        'Identifiant du plan' => ['value' => ''],
        'Mémoire (Mo)' => ['value' => '2048'],
        'Disque (Mo)' => ['value' => '10240'],
        'CPU (%)' => ['value' => '100'],
        'Sauvegardes' => ['value' => '2'],
        'Bases de données' => ['value' => '1'],
        'Ports supplémentaires' => ['value' => '0'],
    ];
    return $m;
}

$echecs = 0;
function verifie(string $titre, bool $condition, string $constate = ''): void
{
    global $echecs;
    if ($condition) {
        echo "  OK   {$titre}\n";
        return;
    }
    $echecs++;
    echo "  ECHEC {$titre}" . ($constate !== '' ? " — constaté : {$constate}" : '') . "\n";
}

echo "Logique du module HostBill\n";

// 1. Client inconnu : compte créé, puis serveur. L'ordre compte.
$s = new ClientSimule();
$m = module($s);
$m->createAccount();
verifie(
    'client inconnu : le compte est créé avant le serveur',
    $s->appels === [
        'findByExternal:4271',
        'findByEmail:paul@exemple.fr',
        'createUser:4271:hostbill-client-4271',
        'createServer:compte-neuf:hostbill-service-9001',
    ],
    implode(' | ', $s->appels)
);

// 2. Reprise de parc : l'adresse existe déjà, on rattache au lieu de doubler.
$s = new ClientSimule();
$s->parEmail = ['id' => 'compte-ancien'];
$m = module($s);
$m->createAccount();
verifie(
    'reprise de parc : le compte existant est rattaché, pas dupliqué',
    in_array('link:compte-ancien:4271', $s->appels, true)
        && !in_array('createUser:4271:hostbill-client-4271', $s->appels, true),
    implode(' | ', $s->appels)
);

// 3. Client déjà connu : aucune création, aucun rattachement.
$s = new ClientSimule();
$s->parExterne = ['id' => 'compte-connu'];
$m = module($s);
$m->createAccount();
verifie(
    'client déjà connu : ni création ni rattachement',
    $s->appels === ['findByExternal:4271', 'createServer:compte-connu:hostbill-service-9001'],
    implode(' | ', $s->appels)
);

// 4. Suspension sans serveur rattaché : doit échouer bruyamment.
$s = new ClientSimule();
$m = module($s);
$ok = $m->suspendAccount();
verifie(
    'suspension sans serveur rattaché : refus explicite, jamais un faux succès',
    $ok === false && $m->erreurs !== [],
    var_export($ok, true)
);

// 5. Résiliation d'un serveur déjà absent : succès, pour ne pas bloquer HostBill.
$s = new ClientSimule();
$m = module($s);
$m->simule = $s;
(function () use ($m) {
    $ref = new ReflectionMethod($m, 'setServiceDetail');
    $ref->setAccessible(true);
    $ref->invoke($m, 'gamedashboard_server_id', 'deja-parti');
})();
$ok = $m->terminateAccount();
verifie(
    'résiliation d\'un serveur déjà supprimé : réussit, sinon le service reste facturable',
    $ok === true,
    var_export($ok, true)
);

// 6. L'ouverture de session rend un lien, sans rediriger.
$s = new ClientSimule();
$m = module($s);
$retour = $m->sso();
verifie(
    'SSO : un tableau avec « link », comme accountModuleSSO l\'attend',
    is_array($retour)
        && ($retour['success'] ?? null) === true
        && str_starts_with((string) ($retour['link'] ?? ''), 'https://panel.test/sso/'),
    json_encode($retour)
);

// 7. Sans adresse e-mail lisible, la création refuse plutôt que d'inventer.
$s = new ClientSimule();
$m = module($s);
$m->emailDuClient = '';
$ok = $m->createAccount();
verifie(
    'adresse introuvable : refus explicite, aucun compte créé au hasard',
    $ok === false
        && !in_array('createUser:4271:hostbill-client-4271', $s->appels, true),
    var_export($ok, true) . ' | ' . implode(' | ', $s->appels)
);

echo $echecs === 0 ? "\nTout passe.\n" : "\n{$echecs} échec(s).\n";
exit($echecs === 0 ? 0 : 1);
