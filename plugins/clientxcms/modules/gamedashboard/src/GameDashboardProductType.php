<?php

namespace App\Modules\GameDashboard;

use App\Abstracts\AbstractProductType;
use App\Contracts\Provisioning\ServerTypeInterface;

/**
 * Le type de produit « serveur GameDashboard », tel que la boutique le voit.
 *
 * Il ne porte aucune décision : il désigne le type de serveur, qui fait tout
 * le travail. Cette séparation est celle de ClientXCMS — le produit décrit ce
 * qui est vendu, le type de serveur décrit comment on le livre.
 */
class GameDashboardProductType extends AbstractProductType
{
    protected string $title = 'GameDashboard';

    protected string $uuid = 'gamedashboard';

    protected string $type = self::SERVICE;

    public function server(): ?ServerTypeInterface
    {
        return new GameDashboardServerType;
    }
}
