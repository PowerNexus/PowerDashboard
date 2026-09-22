/**
 * État du formulaire de connexion.
 *
 * Il vit ici plutôt qu'à côté de l'action `login` parce qu'un fichier marqué
 * comme module d'actions serveur ne peut exporter **que** des fonctions
 * asynchrones : chacun de ses exports devient un point d'entrée appelable à
 * distance, et une valeur n'en est pas un.
 *
 * Next tolère l'écart en développement et le refuse dans la construction de
 * production — où il ne fait pas échouer le build, mais le **rendu**, sur
 * toutes les pages à la fois et sans nommer le fichier fautif.
 *
 * Le type, lui, disparaît à la compilation : c'est la constante qui imposait
 * cette séparation.
 */
export interface LoginState {
  error: string | null;
  /**
   * Défi à renvoyer avec le second facteur, quand le compte en exige un.
   *
   * Sa présence est ce qui fait passer le formulaire à la seconde étape. Il ne
   * donne accès à rien : il nomme seulement, sous chiffrement, le compte dont
   * la preuve est attendue.
   */
  challenge: string | null;
  /**
   * Preuves dont le compte dispose réellement.
   *
   * Proposer « utiliser ma clé d'accès » à quelqu'un qui n'en a pas mènerait à
   * une boîte de dialogue du navigateur vouée à échouer, sans rien expliquer.
   */
  methods: { totp: boolean; passkeys: boolean };
  /** Codes de secours restants, pour prévenir avant qu'il n'y en ait plus. */
  remainingRecoveryCodes: number;
}

export const INITIAL_LOGIN_STATE: LoginState = {
  error: null,
  challenge: null,
  methods: { totp: false, passkeys: false },
  remainingRecoveryCodes: 0,
};
