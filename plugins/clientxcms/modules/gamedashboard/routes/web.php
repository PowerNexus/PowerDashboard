<?php

use App\Modules\GameDashboard\Controllers\GameDashboardController;

/*
 * La route du bouton de l'espace client.
 *
 * Bornée en fréquence : chaque appel fait émettre au panel un lien de
 * connexion valable deux minutes, et rien ne doit permettre d'en fabriquer en
 * rafale. Six par minute suffisent largement à quelqu'un qui clique.
 */
Route::name('gamedashboard.')
    ->prefix('gamedashboard')
    ->middleware(['web', 'throttle:6,1'])
    ->group(function () {
        Route::get('/sso/{service}', [GameDashboardController::class, 'sso'])->name('sso');
    });
