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
  | 'nav.dashboard' | 'nav.myProjects' | 'nav.marketplace' | 'nav.publish'
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
  'nav.publish': 'Publish',
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
  'nav.publish': 'النشر',
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
  'nav.publish': 'Publicar',
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
  'nav.publish': 'Publier',
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

const pt: Bundle = {
  'nav.dashboard': 'Painel',
  'nav.myProjects': 'Meus Projetos',
  'nav.marketplace': 'Marketplace',
  'nav.publish': 'Publicar',
  'nav.referrals': 'Indicações',
  'nav.billing': 'Pagamento',
  'nav.settings': 'Configurações',
  'nav.help': 'Ajuda e Suporte',
  'nav.commandCenter': 'Central de Comando',
  'nav.organization': 'Organização',
  'nav.members': 'Membros',

  'projects.title': 'Meus Projetos',
  'projects.subtitle': 'Tudo o que você criou, agrupado por categoria.',
  'projects.newProject': 'Novo Projeto',
  'projects.noMatch': 'Nenhum projeto corresponde ao filtro atual.',
  'projects.createFirst': 'Crie seu primeiro projeto',
  'projects.noneYet': 'Ainda não há projetos',
  'projects.noneYetBody': 'Crie seu primeiro projeto para começar a gerar conteúdo verificado e pronto para publicação.',
  'projects.active': 'Ativos',
  'projects.recycleBin': 'Lixeira',
  'projects.binEmpty': 'A lixeira está vazia.',
  'projects.status': 'Status',
  'projects.statusAll': 'Todos',
  'projects.statusDraft': 'Rascunho',
  'projects.statusWriting': 'Escrevendo',
  'projects.statusComplete': 'Concluído',
  'projects.statusPublished': 'Publicado',
  'projects.categoryAll': 'Todos',
  'projects.notStarted': 'Não iniciado',
  'projects.untitled': 'Sem título',

  'action.moveToBin': 'Mover para a lixeira',
  'action.restore': 'Restaurar',
  'action.deleteForever': 'Excluir permanentemente',
  'action.cancel': 'Cancelar',
  'action.deleting': 'Excluindo…',

  'confirm.title': 'Excluir este projeto permanentemente?',
  'confirm.bodyPrefix': 'e todos os seus capítulos, capas, pesquisas e histórico de publicação serão excluídos para sempre.',
  'confirm.bodySuffix': '',
  'confirm.cannotUndo': 'Esta ação não pode ser desfeita.',

  'toast.movedToBin': 'Movido para a lixeira',
  'toast.restored': 'Restaurado',
  'toast.deletedPermanently': 'Excluído permanentemente',

  'time.justNow': 'agora mesmo',
  'time.deletedPrefix': 'Excluído',
};

const ru: Bundle = {
  'nav.dashboard': 'Панель',
  'nav.myProjects': 'Мои проекты',
  'nav.marketplace': 'Маркетплейс',
  'nav.publish': 'Публикация',
  'nav.referrals': 'Рефералы',
  'nav.billing': 'Оплата',
  'nav.settings': 'Настройки',
  'nav.help': 'Помощь и поддержка',
  'nav.commandCenter': 'Центр управления',
  'nav.organization': 'Организация',
  'nav.members': 'Участники',

  'projects.title': 'Мои проекты',
  'projects.subtitle': 'Всё, что вы создали, по категориям.',
  'projects.newProject': 'Новый проект',
  'projects.noMatch': 'Нет проектов, соответствующих фильтру.',
  'projects.createFirst': 'Создайте свой первый проект',
  'projects.noneYet': 'Проектов пока нет',
  'projects.noneYetBody': 'Создайте первый проект, чтобы начать генерировать проверенный, готовый к публикации контент.',
  'projects.active': 'Активные',
  'projects.recycleBin': 'Корзина',
  'projects.binEmpty': 'Корзина пуста.',
  'projects.status': 'Статус',
  'projects.statusAll': 'Все',
  'projects.statusDraft': 'Черновик',
  'projects.statusWriting': 'Пишется',
  'projects.statusComplete': 'Готов',
  'projects.statusPublished': 'Опубликован',
  'projects.categoryAll': 'Все',
  'projects.notStarted': 'Не начат',
  'projects.untitled': 'Без названия',

  'action.moveToBin': 'Переместить в корзину',
  'action.restore': 'Восстановить',
  'action.deleteForever': 'Удалить навсегда',
  'action.cancel': 'Отмена',
  'action.deleting': 'Удаление…',

  'confirm.title': 'Удалить этот проект навсегда?',
  'confirm.bodyPrefix': 'со всеми главами, обложками, исследованиями и историей публикаций будет удалён навсегда.',
  'confirm.bodySuffix': '',
  'confirm.cannotUndo': 'Это действие нельзя отменить.',

  'toast.movedToBin': 'Перемещено в корзину',
  'toast.restored': 'Восстановлено',
  'toast.deletedPermanently': 'Удалено навсегда',

  'time.justNow': 'только что',
  'time.deletedPrefix': 'Удалено',
};

const zh: Bundle = {
  'nav.dashboard': '仪表盘',
  'nav.myProjects': '我的项目',
  'nav.marketplace': '市场',
  'nav.publish': '发布',
  'nav.referrals': '推荐',
  'nav.billing': '账单',
  'nav.settings': '设置',
  'nav.help': '帮助与支持',
  'nav.commandCenter': '指挥中心',
  'nav.organization': '组织',
  'nav.members': '成员',

  'projects.title': '我的项目',
  'projects.subtitle': '您创建的所有内容,按类别分组。',
  'projects.newProject': '新建项目',
  'projects.noMatch': '没有符合当前筛选条件的项目。',
  'projects.createFirst': '创建您的第一个项目',
  'projects.noneYet': '还没有项目',
  'projects.noneYetBody': '创建您的第一个项目,开始生成经过验证、可发布的内容。',
  'projects.active': '活跃',
  'projects.recycleBin': '回收站',
  'projects.binEmpty': '回收站为空。',
  'projects.status': '状态',
  'projects.statusAll': '全部',
  'projects.statusDraft': '草稿',
  'projects.statusWriting': '撰写中',
  'projects.statusComplete': '已完成',
  'projects.statusPublished': '已发布',
  'projects.categoryAll': '全部',
  'projects.notStarted': '未开始',
  'projects.untitled': '无标题',

  'action.moveToBin': '移至回收站',
  'action.restore': '恢复',
  'action.deleteForever': '永久删除',
  'action.cancel': '取消',
  'action.deleting': '正在删除…',

  'confirm.title': '永久删除此项目?',
  'confirm.bodyPrefix': '以及所有章节、封面、研究资料和发布历史都将被永久删除。',
  'confirm.bodySuffix': '',
  'confirm.cannotUndo': '此操作无法撤销。',

  'toast.movedToBin': '已移至回收站',
  'toast.restored': '已恢复',
  'toast.deletedPermanently': '已永久删除',

  'time.justNow': '刚刚',
  'time.deletedPrefix': '已删除',
};

const bn: Bundle = {
  'nav.dashboard': 'ড্যাশবোর্ড',
  'nav.myProjects': 'আমার প্রকল্প',
  'nav.marketplace': 'মার্কেটপ্লেস',
  'nav.publish': 'প্রকাশ করুন',
  'nav.referrals': 'রেফারেল',
  'nav.billing': 'বিলিং',
  'nav.settings': 'সেটিংস',
  'nav.help': 'সাহায্য ও সহায়তা',
  'nav.commandCenter': 'কমান্ড সেন্টার',
  'nav.organization': 'সংস্থা',
  'nav.members': 'সদস্যগণ',

  'projects.title': 'আমার প্রকল্প',
  'projects.subtitle': 'আপনি যা তৈরি করেছেন সব, বিভাগ অনুসারে সাজানো।',
  'projects.newProject': 'নতুন প্রকল্প',
  'projects.noMatch': 'বর্তমান ফিল্টারের সাথে কোনো প্রকল্প মেলে না।',
  'projects.createFirst': 'আপনার প্রথম প্রকল্প তৈরি করুন',
  'projects.noneYet': 'এখনো কোনো প্রকল্প নেই',
  'projects.noneYetBody': 'যাচাই করা, প্রকাশের জন্য প্রস্তুত কনটেন্ট তৈরি শুরু করতে আপনার প্রথম প্রকল্প তৈরি করুন।',
  'projects.active': 'সক্রিয়',
  'projects.recycleBin': 'রিসাইকেল বিন',
  'projects.binEmpty': 'রিসাইকেল বিন খালি।',
  'projects.status': 'অবস্থা',
  'projects.statusAll': 'সব',
  'projects.statusDraft': 'খসড়া',
  'projects.statusWriting': 'লেখা হচ্ছে',
  'projects.statusComplete': 'সম্পূর্ণ',
  'projects.statusPublished': 'প্রকাশিত',
  'projects.categoryAll': 'সব',
  'projects.notStarted': 'শুরু হয়নি',
  'projects.untitled': 'শিরোনামহীন',

  'action.moveToBin': 'রিসাইকেল বিনে সরান',
  'action.restore': 'পুনরুদ্ধার',
  'action.deleteForever': 'চিরতরে মুছুন',
  'action.cancel': 'বাতিল',
  'action.deleting': 'মুছে ফেলা হচ্ছে…',

  'confirm.title': 'এই প্রকল্পটি স্থায়ীভাবে মুছে ফেলবেন?',
  'confirm.bodyPrefix': 'এবং এর সমস্ত অধ্যায়, প্রচ্ছদ, গবেষণা ও প্রকাশনার ইতিহাস চিরতরে মুছে যাবে।',
  'confirm.bodySuffix': '',
  'confirm.cannotUndo': 'এই ক্রিয়াটি পূর্বাবস্থায় ফেরানো যাবে না।',

  'toast.movedToBin': 'রিসাইকেল বিনে সরানো হয়েছে',
  'toast.restored': 'পুনরুদ্ধার করা হয়েছে',
  'toast.deletedPermanently': 'স্থায়ীভাবে মুছে ফেলা হয়েছে',

  'time.justNow': 'এইমাত্র',
  'time.deletedPrefix': 'মুছে ফেলা',
};

const hi: Bundle = {
  'nav.dashboard': 'डैशबोर्ड',
  'nav.myProjects': 'मेरी परियोजनाएँ',
  'nav.marketplace': 'मार्केटप्लेस',
  'nav.publish': 'प्रकाशित करें',
  'nav.referrals': 'रेफ़रल',
  'nav.billing': 'बिलिंग',
  'nav.settings': 'सेटिंग्स',
  'nav.help': 'सहायता और समर्थन',
  'nav.commandCenter': 'कमांड सेंटर',
  'nav.organization': 'संगठन',
  'nav.members': 'सदस्य',

  'projects.title': 'मेरी परियोजनाएँ',
  'projects.subtitle': 'आपकी सभी रचनाएँ, श्रेणी के अनुसार।',
  'projects.newProject': 'नई परियोजना',
  'projects.noMatch': 'वर्तमान फ़िल्टर से मेल खाने वाली कोई परियोजना नहीं।',
  'projects.createFirst': 'अपनी पहली परियोजना बनाएँ',
  'projects.noneYet': 'अभी तक कोई परियोजना नहीं',
  'projects.noneYetBody': 'सत्यापित, प्रकाशन-तैयार सामग्री बनाना शुरू करने के लिए अपनी पहली परियोजना बनाएँ।',
  'projects.active': 'सक्रिय',
  'projects.recycleBin': 'रीसायकल बिन',
  'projects.binEmpty': 'रीसायकल बिन खाली है।',
  'projects.status': 'स्थिति',
  'projects.statusAll': 'सभी',
  'projects.statusDraft': 'मसौदा',
  'projects.statusWriting': 'लेखन में',
  'projects.statusComplete': 'पूर्ण',
  'projects.statusPublished': 'प्रकाशित',
  'projects.categoryAll': 'सभी',
  'projects.notStarted': 'शुरू नहीं हुआ',
  'projects.untitled': 'बिना शीर्षक',

  'action.moveToBin': 'रीसायकल बिन में ले जाएँ',
  'action.restore': 'पुनर्स्थापित करें',
  'action.deleteForever': 'हमेशा के लिए हटाएँ',
  'action.cancel': 'रद्द करें',
  'action.deleting': 'हटाया जा रहा है…',

  'confirm.title': 'इस परियोजना को स्थायी रूप से हटाएँ?',
  'confirm.bodyPrefix': 'और इसके सभी अध्याय, कवर, शोध और प्रकाशन इतिहास हमेशा के लिए हटा दिए जाएँगे।',
  'confirm.bodySuffix': '',
  'confirm.cannotUndo': 'यह क्रिया पूर्ववत नहीं की जा सकती।',

  'toast.movedToBin': 'रीसायकल बिन में ले जाया गया',
  'toast.restored': 'पुनर्स्थापित किया गया',
  'toast.deletedPermanently': 'स्थायी रूप से हटा दिया गया',

  'time.justNow': 'अभी-अभी',
  'time.deletedPrefix': 'हटाया गया',
};

const id: Bundle = {
  'nav.dashboard': 'Dasbor',
  'nav.myProjects': 'Proyek Saya',
  'nav.marketplace': 'Marketplace',
  'nav.publish': 'Terbitkan',
  'nav.referrals': 'Rujukan',
  'nav.billing': 'Penagihan',
  'nav.settings': 'Pengaturan',
  'nav.help': 'Bantuan & Dukungan',
  'nav.commandCenter': 'Pusat Kendali',
  'nav.organization': 'Organisasi',
  'nav.members': 'Anggota',

  'projects.title': 'Proyek Saya',
  'projects.subtitle': 'Semua yang telah Anda buat, dikelompokkan berdasarkan kategori.',
  'projects.newProject': 'Proyek Baru',
  'projects.noMatch': 'Tidak ada proyek yang cocok dengan filter saat ini.',
  'projects.createFirst': 'Buat Proyek Pertama Anda',
  'projects.noneYet': 'Belum ada proyek',
  'projects.noneYetBody': 'Buat proyek pertama Anda untuk mulai menghasilkan konten terverifikasi dan siap terbit.',
  'projects.active': 'Aktif',
  'projects.recycleBin': 'Tempat Sampah',
  'projects.binEmpty': 'Tempat sampah kosong.',
  'projects.status': 'Status',
  'projects.statusAll': 'Semua',
  'projects.statusDraft': 'Draf',
  'projects.statusWriting': 'Sedang ditulis',
  'projects.statusComplete': 'Selesai',
  'projects.statusPublished': 'Diterbitkan',
  'projects.categoryAll': 'Semua',
  'projects.notStarted': 'Belum dimulai',
  'projects.untitled': 'Tanpa judul',

  'action.moveToBin': 'Pindahkan ke tempat sampah',
  'action.restore': 'Pulihkan',
  'action.deleteForever': 'Hapus selamanya',
  'action.cancel': 'Batal',
  'action.deleting': 'Menghapus…',

  'confirm.title': 'Hapus proyek ini secara permanen?',
  'confirm.bodyPrefix': 'beserta seluruh bab, sampul, riset, dan riwayat penerbitannya akan dihapus selamanya.',
  'confirm.bodySuffix': '',
  'confirm.cannotUndo': 'Tindakan ini tidak dapat dibatalkan.',

  'toast.movedToBin': 'Dipindahkan ke tempat sampah',
  'toast.restored': 'Dipulihkan',
  'toast.deletedPermanently': 'Dihapus permanen',

  'time.justNow': 'baru saja',
  'time.deletedPrefix': 'Dihapus',
};

const vi: Bundle = {
  'nav.dashboard': 'Bảng điều khiển',
  'nav.myProjects': 'Dự án của tôi',
  'nav.marketplace': 'Chợ',
  'nav.publish': 'Xuất bản',
  'nav.referrals': 'Giới thiệu',
  'nav.billing': 'Thanh toán',
  'nav.settings': 'Cài đặt',
  'nav.help': 'Trợ giúp & Hỗ trợ',
  'nav.commandCenter': 'Trung tâm điều hành',
  'nav.organization': 'Tổ chức',
  'nav.members': 'Thành viên',

  'projects.title': 'Dự án của tôi',
  'projects.subtitle': 'Mọi thứ bạn đã tạo, được nhóm theo danh mục.',
  'projects.newProject': 'Dự án mới',
  'projects.noMatch': 'Không có dự án nào khớp với bộ lọc hiện tại.',
  'projects.createFirst': 'Tạo dự án đầu tiên của bạn',
  'projects.noneYet': 'Chưa có dự án nào',
  'projects.noneYetBody': 'Tạo dự án đầu tiên để bắt đầu tạo nội dung đã xác minh, sẵn sàng xuất bản.',
  'projects.active': 'Đang hoạt động',
  'projects.recycleBin': 'Thùng rác',
  'projects.binEmpty': 'Thùng rác trống.',
  'projects.status': 'Trạng thái',
  'projects.statusAll': 'Tất cả',
  'projects.statusDraft': 'Bản nháp',
  'projects.statusWriting': 'Đang viết',
  'projects.statusComplete': 'Hoàn thành',
  'projects.statusPublished': 'Đã xuất bản',
  'projects.categoryAll': 'Tất cả',
  'projects.notStarted': 'Chưa bắt đầu',
  'projects.untitled': 'Chưa đặt tên',

  'action.moveToBin': 'Chuyển vào thùng rác',
  'action.restore': 'Khôi phục',
  'action.deleteForever': 'Xóa vĩnh viễn',
  'action.cancel': 'Hủy',
  'action.deleting': 'Đang xóa…',

  'confirm.title': 'Xóa dự án này vĩnh viễn?',
  'confirm.bodyPrefix': 'và tất cả chương, bìa, nghiên cứu và lịch sử xuất bản sẽ bị xóa vĩnh viễn.',
  'confirm.bodySuffix': '',
  'confirm.cannotUndo': 'Không thể hoàn tác hành động này.',

  'toast.movedToBin': 'Đã chuyển vào thùng rác',
  'toast.restored': 'Đã khôi phục',
  'toast.deletedPermanently': 'Đã xóa vĩnh viễn',

  'time.justNow': 'vừa xong',
  'time.deletedPrefix': 'Đã xóa',
};

const BUNDLES: Record<Locale, Bundle> = {
  en,
  ar,
  es,
  fr,
  pt,
  ru,
  zh,
  bn,
  hi,
  id,
  vi,
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
