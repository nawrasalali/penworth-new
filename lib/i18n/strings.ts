/**
 * Minimal i18n for the app shell (sidebar, page titles, action buttons).
 *
 * This is intentionally simple — a hand-curated table of ~30 strings that
 * actually appear on the shell. Heavy lifting (chapters, prose, emails) is
 * done by the AI in the author's language via lib/ai/user-language.ts.
 *
 * Adding a new string:
 *   1. Add the key to StringKey below
 *   2. Add translations to each language map
 *   3. Use <T k="..." />  or  t('...', locale)  in a component
 */

export const SUPPORTED_LOCALES = [
  'en','ar','es','pt','ru','zh','bn','hi','id','fr','vi',
] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export type StringKey =
  // Nav
  | 'nav.dashboard' | 'nav.myProjects' | 'nav.marketplace'
  | 'nav.referrals' | 'nav.billing' | 'nav.settings' | 'nav.help'
  | 'nav.commandCenter' | 'nav.organization' | 'nav.members'
  // My Projects page
  | 'projects.title' | 'projects.subtitle' | 'projects.newProject'
  | 'projects.noMatch' | 'projects.createFirst' | 'projects.noneYet' | 'projects.noneYetBody'
  | 'projects.active' | 'projects.recycleBin' | 'projects.binEmpty'
  | 'projects.status' | 'projects.statusAll' | 'projects.statusDraft'
  | 'projects.statusWriting' | 'projects.statusComplete' | 'projects.statusPublished'
  | 'projects.categoryAll' | 'projects.notStarted' | 'projects.untitled'
  // Actions
  | 'action.moveToBin' | 'action.restore' | 'action.deleteForever'
  | 'action.cancel' | 'action.deleting'
  // Confirm modal
  | 'confirm.title' | 'confirm.cannotUndo' | 'confirm.bodyPrefix' | 'confirm.bodySuffix'
  // Toasts
  | 'toast.movedToBin' | 'toast.restored' | 'toast.deletedPermanently'
  // Relative time
  | 'time.justNow' | 'time.deletedPrefix';

type Bundle = Record<StringKey, string>;

const en: Bundle = {
  'nav.dashboard': 'Dashboard',
  'nav.myProjects': 'My Projects',
  'nav.marketplace': 'Marketplace',
  'nav.referrals': 'Referrals',
  'nav.billing': 'Billing',
  'nav.settings': 'Settings',
  'nav.help': 'Help & Support',
  'nav.commandCenter': 'Command Center',
  'nav.organization': 'Organization',
  'nav.members': 'Members',

  'projects.title': 'My Projects',
  'projects.subtitle': "Everything you've created, grouped by category.",
  'projects.newProject': 'New Project',
  'projects.noMatch': 'No projects match the current filter.',
  'projects.createFirst': 'Create Your First Project',
  'projects.noneYet': 'No projects yet',
  'projects.noneYetBody': 'Create your first project to start generating verified, publication-ready content.',
  'projects.active': 'Active',
  'projects.recycleBin': 'Recycle Bin',
  'projects.binEmpty': 'The recycle bin is empty.',
  'projects.status': 'Status',
  'projects.statusAll': 'All',
  'projects.statusDraft': 'Draft',
  'projects.statusWriting': 'Writing',
  'projects.statusComplete': 'Complete',
  'projects.statusPublished': 'Published',
  'projects.categoryAll': 'All',
  'projects.notStarted': 'Not started',
  'projects.untitled': 'Untitled',

  'action.moveToBin': 'Move to recycle bin',
  'action.restore': 'Restore',
  'action.deleteForever': 'Delete forever',
  'action.cancel': 'Cancel',
  'action.deleting': 'Deleting…',

  'confirm.title': 'Permanently delete this project?',
  'confirm.bodyPrefix': 'and all its chapters, covers, research, and publishing history will be deleted forever.',
  'confirm.bodySuffix': '',
  'confirm.cannotUndo': 'This cannot be undone.',

  'toast.movedToBin': 'Moved to the recycle bin',
  'toast.restored': 'Restored',
  'toast.deletedPermanently': 'Permanently deleted',

  'time.justNow': 'just now',
  'time.deletedPrefix': 'Deleted',
};

const ar: Bundle = {
  'nav.dashboard': 'لوحة التحكم',
  'nav.myProjects': 'مشاريعي',
  'nav.marketplace': 'السوق',
  'nav.referrals': 'الإحالات',
  'nav.billing': 'الفواتير',
  'nav.settings': 'الإعدادات',
  'nav.help': 'المساعدة والدعم',
  'nav.commandCenter': 'مركز القيادة',
  'nav.organization': 'المؤسسة',
  'nav.members': 'الأعضاء',

  'projects.title': 'مشاريعي',
  'projects.subtitle': 'كل ما أنشأته، مصنّفًا حسب الفئة.',
  'projects.newProject': 'مشروع جديد',
  'projects.noMatch': 'لا توجد مشاريع تطابق المرشح الحالي.',
  'projects.createFirst': 'أنشئ أول مشروع لك',
  'projects.noneYet': 'لا توجد مشاريع بعد',
  'projects.noneYetBody': 'أنشئ أول مشروع لتبدأ إنتاج محتوى موثّق وجاهز للنشر.',
  'projects.active': 'نشط',
  'projects.recycleBin': 'سلة المحذوفات',
  'projects.binEmpty': 'سلة المحذوفات فارغة.',
  'projects.status': 'الحالة',
  'projects.statusAll': 'الكل',
  'projects.statusDraft': 'مسودة',
  'projects.statusWriting': 'قيد الكتابة',
  'projects.statusComplete': 'مكتمل',
  'projects.statusPublished': 'منشور',
  'projects.categoryAll': 'الكل',
  'projects.notStarted': 'لم يبدأ',
  'projects.untitled': 'بدون عنوان',

  'action.moveToBin': 'نقل إلى سلة المحذوفات',
  'action.restore': 'استعادة',
  'action.deleteForever': 'حذف نهائي',
  'action.cancel': 'إلغاء',
  'action.deleting': 'جارٍ الحذف…',

  'confirm.title': 'هل تريد حذف هذا المشروع نهائيًا؟',
  'confirm.bodyPrefix': 'وجميع فصوله وأغلفته وأبحاثه وسجل نشره ستُحذف إلى الأبد.',
  'confirm.bodySuffix': '',
  'confirm.cannotUndo': 'لا يمكن التراجع عن هذا الإجراء.',

  'toast.movedToBin': 'تم النقل إلى سلة المحذوفات',
  'toast.restored': 'تمت الاستعادة',
  'toast.deletedPermanently': 'تم الحذف نهائيًا',

  'time.justNow': 'الآن',
  'time.deletedPrefix': 'حُذف',
};

const es: Bundle = {
  'nav.dashboard': 'Panel',
  'nav.myProjects': 'Mis Proyectos',
  'nav.marketplace': 'Mercado',
  'nav.referrals': 'Referidos',
  'nav.billing': 'Facturación',
  'nav.settings': 'Ajustes',
  'nav.help': 'Ayuda',
  'nav.commandCenter': 'Centro de Mando',
  'nav.organization': 'Organización',
  'nav.members': 'Miembros',

  'projects.title': 'Mis Proyectos',
  'projects.subtitle': 'Todo lo que has creado, agrupado por categoría.',
  'projects.newProject': 'Nuevo Proyecto',
  'projects.noMatch': 'No hay proyectos que coincidan con el filtro.',
  'projects.createFirst': 'Crea tu primer proyecto',
  'projects.noneYet': 'Aún no hay proyectos',
  'projects.noneYetBody': 'Crea tu primer proyecto para empezar a generar contenido verificado y listo para publicar.',
  'projects.active': 'Activos',
  'projects.recycleBin': 'Papelera',
  'projects.binEmpty': 'La papelera está vacía.',
  'projects.status': 'Estado',
  'projects.statusAll': 'Todos',
  'projects.statusDraft': 'Borrador',
  'projects.statusWriting': 'Escribiendo',
  'projects.statusComplete': 'Completo',
  'projects.statusPublished': 'Publicado',
  'projects.categoryAll': 'Todos',
  'projects.notStarted': 'Sin empezar',
  'projects.untitled': 'Sin título',

  'action.moveToBin': 'Mover a la papelera',
  'action.restore': 'Restaurar',
  'action.deleteForever': 'Eliminar para siempre',
  'action.cancel': 'Cancelar',
  'action.deleting': 'Eliminando…',

  'confirm.title': '¿Eliminar este proyecto permanentemente?',
  'confirm.bodyPrefix': 'y todos sus capítulos, portadas, investigación e historial de publicación se eliminarán para siempre.',
  'confirm.bodySuffix': '',
  'confirm.cannotUndo': 'Esta acción no se puede deshacer.',

  'toast.movedToBin': 'Movido a la papelera',
  'toast.restored': 'Restaurado',
  'toast.deletedPermanently': 'Eliminado permanentemente',

  'time.justNow': 'ahora',
  'time.deletedPrefix': 'Eliminado',
};

const fr: Bundle = {
  'nav.dashboard': 'Tableau de bord',
  'nav.myProjects': 'Mes projets',
  'nav.marketplace': 'Marketplace',
  'nav.referrals': 'Parrainage',
  'nav.billing': 'Facturation',
  'nav.settings': 'Paramètres',
  'nav.help': 'Aide',
  'nav.commandCenter': 'Centre de contrôle',
  'nav.organization': 'Organisation',
  'nav.members': 'Membres',

  'projects.title': 'Mes projets',
  'projects.subtitle': 'Tout ce que vous avez créé, classé par catégorie.',
  'projects.newProject': 'Nouveau projet',
  'projects.noMatch': 'Aucun projet ne correspond au filtre actuel.',
  'projects.createFirst': 'Créez votre premier projet',
  'projects.noneYet': 'Pas encore de projets',
  'projects.noneYetBody': 'Créez votre premier projet pour générer du contenu vérifié et prêt à publier.',
  'projects.active': 'Actifs',
  'projects.recycleBin': 'Corbeille',
  'projects.binEmpty': 'La corbeille est vide.',
  'projects.status': 'Statut',
  'projects.statusAll': 'Tous',
  'projects.statusDraft': 'Brouillon',
  'projects.statusWriting': 'En cours',
  'projects.statusComplete': 'Terminé',
  'projects.statusPublished': 'Publié',
  'projects.categoryAll': 'Tous',
  'projects.notStarted': 'Non commencé',
  'projects.untitled': 'Sans titre',

  'action.moveToBin': 'Mettre à la corbeille',
  'action.restore': 'Restaurer',
  'action.deleteForever': 'Supprimer définitivement',
  'action.cancel': 'Annuler',
  'action.deleting': 'Suppression…',

  'confirm.title': 'Supprimer ce projet définitivement ?',
  'confirm.bodyPrefix': 'ainsi que tous ses chapitres, couvertures, recherches et historique de publication seront supprimés pour toujours.',
  'confirm.bodySuffix': '',
  'confirm.cannotUndo': 'Cette action est irréversible.',

  'toast.movedToBin': 'Déplacé dans la corbeille',
  'toast.restored': 'Restauré',
  'toast.deletedPermanently': 'Supprimé définitivement',

  'time.justNow': "à l'instant",
  'time.deletedPrefix': 'Supprimé',
};

// For the remaining 7 languages, fall back to English for now. Each can be
// filled in progressively (a single commit per language) without touching the
// components that consume t().
const BUNDLES: Record<Locale, Bundle> = {
  en,
  ar,
  es,
  fr,
  pt: en,
  ru: en,
  zh: en,
  bn: en,
  hi: en,
  id: en,
  vi: en,
};

export function t(key: StringKey, locale: Locale = 'en'): string {
  const bundle = BUNDLES[locale] || en;
  return bundle[key] || en[key] || key;
}

/** Right-to-left languages. Used for <html dir="rtl"> and layout mirroring. */
export const RTL_LOCALES: Locale[] = ['ar'];
export function isRTL(locale: string | null | undefined): boolean {
  return !!locale && (RTL_LOCALES as string[]).includes(locale);
}

export function isSupportedLocale(code: string | null | undefined): code is Locale {
  return !!code && (SUPPORTED_LOCALES as readonly string[]).includes(code);
}
