/**
 * Les feuilles de style importées depuis du TypeScript (preview Storybook,
 * application) n'ont pas de type propre : ce module les déclare pour que leur
 * import ne soit pas une erreur, sans pour autant les typer à `any`.
 */
declare module "*.css" {
  const content: string;
  export default content;
}
