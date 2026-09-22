{*
    Affiché sur la fiche du service, dans l'espace client.

    Un seul bouton, et un lien vers une adresse que WHMCS reconnaît :
    `dosinglesignon=1` déclenche `gamedashboard_ServiceSingleSignOn`, qui
    demande au panel un lien à usage unique et laisse WHMCS rediriger.

    Rien d'autre n'est affiché ici : tout ce qui concerne le serveur — console,
    fichiers, sauvegardes — vit dans le panel, et le recopier dans l'espace
    client ferait deux écrans à tenir d'accord.
*}
<div class="text-center" style="margin: 20px 0;">
    <a href="{$ssoUrl}" class="btn btn-primary btn-lg">
        Gérer mon serveur
    </a>
    <p class="text-muted" style="margin-top: 10px;">
        Vous serez connecté automatiquement : aucun mot de passe à saisir.
    </p>
</div>
