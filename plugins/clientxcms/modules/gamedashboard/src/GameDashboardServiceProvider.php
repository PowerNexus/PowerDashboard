<?php

namespace App\Modules\GameDashboard;

use App\Extensions\BaseModuleServiceProvider;

/**
 * Point d'entrée du module dans ClientXCMS.
 *
 * Il déclare le type de produit, charge les vues et les traductions, et
 * enregistre la route du bouton « Gérer mon serveur ».
 *
 * Volontairement mince : tout ce qui est décision vit dans
 * `GameDashboardServerType`, que l'on peut éprouver sans monter un Laravel.
 * Un fournisseur qui porterait de la logique obligerait à installer
 * ClientXCMS pour vérifier la moindre règle.
 */
class GameDashboardServiceProvider extends BaseModuleServiceProvider
{
    protected string $name = 'GameDashboard';

    protected string $version = '1.0.0';

    protected string $uuid = 'gamedashboard';

    public function boot(): void
    {
        $this->loadViews();
        $this->loadTranslations();
        $this->registerProductTypes();

        \Route::middleware('web')->group(module_path('gamedashboard', 'routes/web.php'));
    }

    public function productsTypes(): array
    {
        return [
            GameDashboardProductType::class,
        ];
    }
}
