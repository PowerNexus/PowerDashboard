{{--
    Affiché sur la fiche du service, dans l'espace client.

    Un seul bouton. Tout ce qui concerne le serveur — console, fichiers,
    sauvegardes — vit dans le panel, et le recopier ici ferait deux écrans à
    tenir d'accord.
--}}
<div class="text-center my-6">
    <a href="{{ route('gamedashboard.sso', $service->id) }}"
       class="btn btn-primary btn-lg">
        {{ __('gamedashboard::messages.manage') }}
    </a>
    <p class="text-sm text-gray-500 mt-2">
        {{ __('gamedashboard::messages.manage_hint') }}
    </p>
</div>
