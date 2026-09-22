<?php

namespace App\Modules\GameDashboard\Controllers;

use App\Models\Provisioning\Service;
use App\Modules\GameDashboard\GameDashboardServerType;

/**
 * Le bouton « Gérer mon serveur » de l'espace client.
 *
 * Demande un lien à usage unique et redirige dessus. Le lien vaut deux
 * minutes : la redirection est immédiate plutôt qu'un lien affiché, pour que
 * le délai entre l'émission et l'usage reste celui d'un aller-retour réseau.
 *
 * **L'appartenance est vérifiée ici.** Une route d'espace client reçoit un
 * identifiant de service dans l'URL, et rien n'empêche quelqu'un d'y mettre
 * celui d'un autre. Sans ce contrôle, un client obtiendrait une session
 * ouverte sur le serveur de son voisin — le lien, lui, est émis pour le
 * titulaire du service, pas pour le demandeur.
 */
class GameDashboardController
{
    public function sso(Service $service)
    {
        $customer = auth('customer')->user();

        if ($customer === null || (int) $service->customer_id !== (int) $customer->id) {
            abort(403);
        }

        try {
            $url = (new GameDashboardServerType)->ssoLink($service);
        } catch (\GameDashboardError $e) {
            return back()->with('error', $e->getMessage());
        }

        return redirect()->away($url);
    }
}
