<?php

require_once __DIR__ . '/includes/GameDashboardClient.php';

/**
 * Module serveur HostBill pour GameDashboard.
 *
 * Il fait les deux métiers que le panel attend d'un système de facturation :
 *
 * 1. **le provisionnement** — une commande payée crée le compte et le serveur,
 *    un impayé suspend, une résiliation supprime ;
 * 2. **la connexion** — le bouton « Gérer mon serveur » de l'espace client
 *    demande au panel un lien à usage unique et y redirige. Le client n'a pas
 *    de mot de passe sur le panel et n'en aura jamais : c'est ici qu'il
 *    s'authentifie, et le panel lui fait confiance sur la foi de la clé
 *    applicative.
 *
 * **L'ordre des gestes compte à la création** : le compte d'abord, le serveur
 * ensuite. Le panel refuse d'ouvrir une session pour un client qu'il ne
 * connaît pas, et refuse de créer un serveur sans propriétaire. Faire
 * l'inverse laisserait un serveur orphelin après un échec.
 *
 * ---
 *
 * **Ce qui a été éprouvé, et ce qui ne l'a pas été.** Le client d'API
 * (`includes/GameDashboardClient.php`) a été exécuté contre un panel réel :
 * création, idempotence, recherche, lien de connexion, et les refus. Le module
 * lui-même n'a pas tourné dans HostBill, faute d'instance à disposition. Les
 * points à confirmer à la première installation sont regroupés dans
 * `hostbillValue()` et signalés là-bas : ce sont les noms sous lesquels
 * HostBill expose ses propres données, et eux seuls.
 */
class gamedashboard extends HBServerModule
{
    protected $modname = 'GameDashboard';
    protected $description = 'Provisionnement et connexion des serveurs de jeu GameDashboard.';
    protected $version = '1.0.0';

    /**
     * Ce qu'on renseigne une fois, dans la fiche du serveur HostBill.
     *
     * L'adresse du panel et la clé applicative. Rien d'autre : le reste — quel
     * egg, quelles ressources — dépend du produit, pas du panel, et se règle
     * donc par produit.
     */
    public function getOptions()
    {
        return [
            'Adresse du panel' => [
                'value' => 'https://panel.exemple.fr',
                'type' => 'input',
                'description' => 'Sans barre finale. Doit être joignable en HTTPS depuis ce serveur HostBill.',
            ],
            'Clé applicative' => [
                'value' => '',
                'type' => 'inputpassword',
                'description' => 'Créée dans le panel sous Administration → Clés applicatives. '
                    . 'Portées nécessaires : users.read, users.write, users.sso, servers.create, '
                    . 'servers.suspend, servers.delete.',
            ],
            'Identifiant de l\'offre (egg)' => [
                'value' => '',
                'type' => 'input',
                'description' => 'Identifiant de l\'egg à installer. Visible dans le panel sous Administration → Eggs.',
            ],
            'Identifiant du plan' => [
                'value' => '',
                'type' => 'input',
                'description' => 'Facultatif. Renseigné, il décide des ressources ; sinon elles viennent des champs ci-dessous.',
            ],
            'Mémoire (Mo)' => ['value' => '2048', 'type' => 'input'],
            'Disque (Mo)' => ['value' => '10240', 'type' => 'input'],
            'CPU (%)' => ['value' => '100', 'type' => 'input'],
            'Sauvegardes' => ['value' => '2', 'type' => 'input'],
            'Bases de données' => ['value' => '1', 'type' => 'input'],
            'Ports supplémentaires' => ['value' => '0', 'type' => 'input'],
        ];
    }

    /**
     * Vérifie la configuration sans rien créer.
     *
     * Appelée par le bouton « Test connection » de HostBill. Elle interroge la
     * route `identity` du panel, qui confirme l'adresse, la clé **et** les
     * portées. Un essai par une vraie création laisserait derrière lui un
     * serveur à supprimer à la main.
     */
    public function testConnection()
    {
        try {
            $identite = $this->client()->identity();
            $portees = $identite['data']['scopes'] ?? [];

            $manquantes = array_diff(self::PORTEES_REQUISES, is_array($portees) ? $portees : []);
            if ($manquantes !== []) {
                $this->addError(
                    'La clé fonctionne mais il lui manque des portées : ' . implode(', ', $manquantes)
                );
                return false;
            }

            return true;
        } catch (GameDashboardError $e) {
            $this->addError($e->getMessage());
            return false;
        }
    }

    private const PORTEES_REQUISES = [
        'users.read',
        'users.write',
        'users.sso',
        'servers.create',
        'servers.suspend',
        'servers.delete',
    ];

    /**
     * Une commande payée : le compte, puis le serveur.
     *
     * La **clé d'idempotence** est dérivée de l'identifiant du service
     * HostBill, qui ne change jamais. Un délai réseau qui ferait rejouer
     * l'appel ne créera donc pas un second serveur — et HostBill rejoue,
     * notamment quand un administrateur reclique sur « Create ».
     */
    public function createAccount()
    {
        try {
            $client = $this->client();
            $idClient = (string) $this->hostbillValue('client_id');
            $idService = (string) $this->hostbillValue('service_id');

            $compte = $this->ensureUser($client, $idClient);

            $charge = [
                'ownerId' => $compte['id'],
                'eggId' => trim((string) $this->option('Identifiant de l\'offre (egg)')),
                'name' => $this->serverName(),
            ];

            $plan = trim((string) $this->option('Identifiant du plan'));
            if ($plan !== '') {
                $charge['planId'] = $plan;
            } else {
                $charge['resources'] = [
                    'memoryMb' => (int) $this->option('Mémoire (Mo)'),
                    'diskMb' => (int) $this->option('Disque (Mo)'),
                    'cpuPct' => (int) $this->option('CPU (%)'),
                    'swapMb' => 0,
                    'allocations' => (int) $this->option('Ports supplémentaires'),
                    'backups' => (int) $this->option('Sauvegardes'),
                    'databases' => (int) $this->option('Bases de données'),
                ];
            }

            $reponse = $client->createServer($charge, 'hostbill-service-' . $idService);
            $serveur = $reponse['data'] ?? [];

            /*
             * L'identifiant du serveur est rangé côté HostBill.
             *
             * Sans lui, suspendre et supprimer devraient retrouver le serveur
             * par son nom — qui peut être changé par le client depuis le
             * panel. On suspendrait alors le mauvais, ou plus probablement
             * aucun, en silence.
             */
            $this->setServiceDetail('gamedashboard_server_id', (string) ($serveur['id'] ?? ''));

            return true;
        } catch (GameDashboardError $e) {
            $this->addError($e->getMessage());
            return false;
        }
    }

    /**
     * Retrouve ou crée le compte du client dans le panel.
     *
     * Trois cas, dans cet ordre :
     *
     * 1. le panel connaît déjà cet identifiant HostBill — c'est lui ;
     * 2. il connaît l'adresse mais pas l'identifiant : **on rattache** plutôt
     *    que de créer un doublon. C'est le cas de toute reprise de parc, où
     *    les comptes existaient avant l'installation de ce module ;
     * 3. il ne connaît rien : on crée.
     */
    private function ensureUser(GameDashboardClient $client, string $idClient): array
    {
        $trouve = $client->findUserByExternalId($idClient);
        if ($trouve !== null) {
            return $trouve;
        }

        $email = $this->clientEmail($idClient);
        if ($email === '') {
            throw new GameDashboardError(
                'Impossible de lire l\'adresse e-mail du client #' . $idClient . ' dans HostBill.'
            );
        }

        $parEmail = $client->findUserByEmail($email);
        if ($parEmail !== null) {
            $client->linkExternalId((string) $parEmail['id'], $idClient);
            return $parEmail;
        }

        $cree = $client->createUser(
            $email,
            (string) $this->hostbillValue('client_firstname'),
            (string) $this->hostbillValue('client_lastname'),
            $idClient,
            'hostbill-client-' . $idClient
        );

        return $cree['data'] ?? [];
    }

    /**
     * Adresse e-mail du client, demandée à HostBill.
     *
     * **Elle n'est pas dans les détails du compte.** Ceux-ci portent le nom, le
     * prénom et la société, mais l'adresse appartient à la fiche *client* — ce
     * que la documentation de l'API confirme : `getAccountDetails` ne la rend
     * pas, `getClientDetails` si.
     *
     * L'appel passe par `ApiWrapper`, qui est la façon dont un module HostBill
     * atteint l'API localement, sans identifiants ni requête HTTP.
     *
     * Les détails du compte restent consultés d'abord : si une version de
     * HostBill y joint l'adresse, autant l'employer et s'épargner un appel.
     */
    protected function clientEmail(string $idClient): string
    {
        $direct = trim((string) $this->hostbillValue('client_email'));
        if ($direct !== '') {
            return $direct;
        }

        if (!class_exists('ApiWrapper')) {
            return '';
        }

        try {
            $api = new ApiWrapper();
            $reponse = $api->getClientDetails(['id' => $idClient]);
            return trim((string) ($reponse['client']['email'] ?? ''));
        } catch (Throwable $e) {
            return '';
        }
    }

    /** Impayé : le serveur s'arrête, les fichiers restent. */
    public function suspendAccount()
    {
        return $this->changeSuspension(true, 'Suspendu par la facturation (impayé).');
    }

    /** Paiement reçu : le serveur redevient utilisable. */
    public function unsuspendAccount()
    {
        return $this->changeSuspension(false, '');
    }

    private function changeSuspension(bool $suspendu, string $raison)
    {
        try {
            $id = $this->serverId();
            if ($id === '') {
                // Rien à suspendre : le dire plutôt que de rendre « succès ».
                // Un service marqué suspendu chez HostBill alors que le
                // serveur tourne toujours est la panne la plus coûteuse de
                // cette intégration — le client continue de jouer sans payer,
                // et personne ne s'en aperçoit.
                $this->addError('Aucun serveur GameDashboard n\'est rattaché à ce service.');
                return false;
            }

            $this->client()->setSuspended($id, $suspendu, $raison);
            return true;
        } catch (GameDashboardError $e) {
            $this->addError($e->getMessage());
            return false;
        }
    }

    /**
     * Résiliation : le serveur et ses fichiers disparaissent.
     *
     * Un serveur déjà absent du panel n'est **pas** une erreur : il a pu être
     * supprimé à la main. Rendre un échec bloquerait la résiliation chez
     * HostBill et laisserait un service facturable sans rien derrière.
     */
    public function terminateAccount()
    {
        try {
            $id = $this->serverId();
            if ($id === '') {
                return true;
            }

            try {
                $this->client()->deleteServer($id);
            } catch (GameDashboardNotFound $e) {
                // Déjà parti. La résiliation continue.
            }

            $this->setServiceDetail('gamedashboard_server_id', '');
            return true;
        } catch (GameDashboardError $e) {
            $this->addError($e->getMessage());
            return false;
        }
    }

    /**
     * L'ouverture de session, déclenchée par HostBill.
     *
     * **Rend un lien, ne redirige pas.** C'est le contrat de HostBill : l'appel
     * `accountModuleSSO` de son API « déclenche la méthode SSO du module de
     * provisionnement » et répond `{"success": true, "link": "…"}`. Une version
     * antérieure posait un en-tête `Location` et sortait par `exit`, ce qui
     * aurait court-circuité HostBill et rendu une page blanche à l'API.
     *
     * Le lien n'est ni mis en cache, ni journalisé : il vaut deux minutes et
     * ouvre une session.
     */
    public function sso()
    {
        try {
            return [
                'success' => true,
                'link' => $this->client()->ssoLink((string) $this->hostbillValue('client_id')),
            ];
        } catch (GameDashboardError $e) {
            $this->addError($e->getMessage());
            return ['success' => false, 'error' => $e->getMessage()];
        }
    }

    /**
     * Le bouton de l'espace client, pour les thèmes qui n'emploient pas
     * l'ouverture de session intégrée.
     *
     * Il redirige, lui, parce que c'est un clic du visiteur et non un appel
     * d'API : le lien doit être consommé dans la seconde, pas affiché.
     */
    public function clientArea_sso()
    {
        try {
            $url = $this->client()->ssoLink((string) $this->hostbillValue('client_id'));
            header('Location: ' . $url, true, 302);
            exit;
        } catch (GameDashboardError $e) {
            return [
                'template' => 'error',
                'vars' => ['message' => $e->getMessage()],
            ];
        }
    }

    /** Déclare le bouton à HostBill. */
    public function getClientAreaButtons()
    {
        return ['sso' => 'Gérer mon serveur'];
    }

    /**
     * Fabrique le client d'API.
     *
     * `protected` et non `private` : c'est le seul point par lequel le module
     * touche le réseau, et le rendre remplaçable permet d'éprouver la logique
     * — ordre des gestes, rattachement, refus — sans installer HostBill ni
     * appeler un vrai panel. Voir `tests/module-logic.php`.
     */
    protected function client(): GameDashboardClient
    {
        return new GameDashboardClient(
            (string) $this->option('Adresse du panel'),
            (string) $this->option('Clé applicative')
        );
    }

    private function serverId(): string
    {
        return trim((string) $this->getServiceDetail('gamedashboard_server_id'));
    }

    /**
     * Nom du serveur créé.
     *
     * Le domaine du service quand il y en a un, sinon le nom du produit suivi
     * du numéro de service. Un nom vide produirait une liste de serveurs
     * indistincts dans le panel du client dès qu'il en a deux.
     */
    private function serverName(): string
    {
        $domaine = trim((string) $this->hostbillValue('domain'));
        if ($domaine !== '') {
            return $domaine;
        }

        $produit = trim((string) $this->hostbillValue('product_name'));
        $service = (string) $this->hostbillValue('service_id');
        return ($produit !== '' ? $produit : 'Serveur') . ' #' . $service;
    }

    /**
     * Lecture d'une valeur exposée par HostBill.
     *
     * **Tous les accès aux données de HostBill passent par ici**, et c'est
     * délibéré : ce sont les seuls points que je n'ai pas pu éprouver contre
     * une installation réelle. Les noms exposés varient selon la version, et
     * les regrouper permet de tout corriger en un endroit plutôt que de
     * chasser des `$this->details['...']` dans cinq méthodes.
     *
     * Si le module se comporte mal à la première installation, c'est presque
     * certainement ici : comparez ces clés à ce que votre version de HostBill
     * met dans `$this->details`.
     */
    private function hostbillValue(string $nom)
    {
        /*
         * Les noms viennent de la structure d'un compte telle que l'API
         * HostBill la documente (`getAccountDetails`) : `id`, `client_id`,
         * `domain`, `firstname`, `lastname`, `product_name`.
         *
         * Les variantes conservées en second couvrent l'écart possible entre
         * ce que l'API rend et ce que HostBill passe au module — c'est le seul
         * point que la documentation de l'API ne tranche pas.
         *
         * `email` ne figure dans aucune des deux : il appartient à la fiche
         * client, et `clientEmail()` va le chercher.
         */
        $correspondances = [
            'client_id' => ['client_id', 'clientid', 'userid'],
            'client_email' => ['client_email', 'email'],
            'client_firstname' => ['firstname', 'client_firstname'],
            'client_lastname' => ['lastname', 'client_lastname'],
            'service_id' => ['id', 'service_id', 'accountid'],
            'domain' => ['domain', 'hostname'],
            'product_name' => ['product_name', 'name'],
        ];

        foreach ($correspondances[$nom] ?? [$nom] as $cle) {
            if (isset($this->details[$cle]) && $this->details[$cle] !== '') {
                return $this->details[$cle];
            }
        }

        return '';
    }

    private function option(string $nom)
    {
        return $this->options[$nom]['value'] ?? '';
    }
}
