/**
 * Translations for the four user-visible fields of ValidationRubric across
 * all 8 document-type rubrics × 11 supported locales.
 *
 * The canonical rubrics in `./interview-questions.ts` stay untouched — their
 * `expertise` and `criteria` fields still drive the AI validation prompt on
 * the server, and `criteria` labels still surface on the Validate results
 * card (those are translated separately via validate.breakdown.* keys).
 *
 * Only `intro`, `inputLabel`, `inputPlaceholder`, `buttonLabel` are localised
 * here because those are the strings the user directly reads when they first
 * reach the Validate screen for a given document type.
 *
 * Usage (from ValidateScreen.tsx):
 *
 *   const rubric = getValidationRubric(contentType);
 *   const uiRubric = applyRubricLocale(rubric, locale);
 *   // uiRubric.intro, uiRubric.inputLabel, uiRubric.inputPlaceholder,
 *   // uiRubric.buttonLabel are now in the user's language.
 *   // uiRubric.expertise / uiRubric.criteria unchanged (server-only).
 */

import type { Locale } from '@/lib/i18n/strings';
import type { ValidationRubric } from './interview-questions';

/**
 * Rubric key matches the exact intro text of each source rubric, so we can
 * look up translations without needing to export identifiers from
 * interview-questions.ts.
 */
type RubricKey =
  | 'narrative'
  | 'businessPlan'
  | 'proposal'
  | 'academic'
  | 'legal'
  | 'technical'
  | 'reference'
  | 'shortForm';

interface LocalisedRubric {
  intro: string;
  inputLabel: string;
  inputPlaceholder: string;
  buttonLabel: string;
}

// Identify which rubric we're looking at by matching the canonical English
// intro text (stable across releases — it's the prompt the AI sees, not a
// UI string that might be reworded casually). If we get a new rubric whose
// intro doesn't match, we fall through and show English — same as before.
function identifyRubric(rubric: ValidationRubric): RubricKey | null {
  const intro = rubric.intro;
  if (intro.startsWith('Describe your book idea')) return 'narrative';
  if (intro.startsWith('Describe the business')) return 'businessPlan';
  if (intro.startsWith('Describe the proposal')) return 'proposal';
  if (intro.startsWith('Describe the research question')) return 'academic';
  if (intro.startsWith('Describe the legal document')) return 'legal';
  if (intro.startsWith('Describe the technical document')) return 'technical';
  if (intro.startsWith('Describe your cookbook or guide idea')) return 'reference';
  if (intro.startsWith('Describe the piece')) return 'shortForm';
  return null;
}

// 8 rubrics × 10 non-English locales. English stays in the source rubric.
const TRANSLATIONS: Partial<Record<Exclude<Locale, 'en'>, Record<RubricKey, LocalisedRubric>>> = {
  ar: {
    narrative: {
      intro: 'صِف فكرة كتابك — الموضوع، لمن تكتبه، وما الجديد في زاويتك. سنقدّر الطلب في السوق، وملاءمة الجمهور، وأفضل موقع لتحديد قرارك.',
      inputLabel: 'فكرة كتابك',
      inputPlaceholder: 'دليل عملي لروّاد الأعمال في جنوب شرق آسيا لجمع رأس المال التأسيسي دون شبكة أمريكية. زاويتي هي…',
      buttonLabel: 'تحقّق من فكرة كتابي',
    },
    businessPlan: {
      intro: 'صِف المشروع والغرض من هذه الخطة. سنقيّم فرصة السوق، والحصانة، وجاهزية الخطة للمستثمرين لمساعدتك على تقويتها قبل العرض.',
      inputLabel: 'فكرة عملك',
      inputPlaceholder: 'منصة SaaS لإدارة المخزون بالاشتراك للمتاجر المستقلّة في جنوب شرق آسيا. نبيع لأصحاب 10-50 متجرًا مقابل 89$/شهر. موقعنا المنيع هو…',
      buttonLabel: 'تحقّق من فكرة عملي',
    },
    proposal: {
      intro: 'صِف العرض — ما تقترحه، لمن، وما الذي تريد الموافقة عليه. سنقيّم الوضوح، والتوافق مع القيمة، ومدى الإقناع لتساعدك على كسب الموافقة.',
      inputLabel: 'فكرة عرضك',
      inputPlaceholder: 'عقد استشارة لمدة 6 أشهر لإعادة هيكلة نظام المشتريات في شركة Acme، مُقدَّم لرئيس العمليات بقيمة 180 ألف دولار…',
      buttonLabel: 'تحقّق من عرضي',
    },
    academic: {
      intro: 'صِف سؤال البحث وما الجديد في منهجك. سنقيّم الأصالة، والملاءمة المنهجية، وتقبّل مجالك له لمساعدتك على صياغة ورقة قابلة للدفاع.',
      inputLabel: 'موضوع بحثك',
      inputPlaceholder: 'دراسة مختلطة المنهج عن تأثير العمل عن بُعد على استبقاء المهندسين في بداية حياتهم المهنية بشركات التقنية متوسطة الحجم، باستخدام ن=300 استبيان + 40 مقابلة…',
      buttonLabel: 'تحقّق من فكرة بحثي',
    },
    legal: {
      intro: 'صِف المستند القانوني المطلوب — الأطراف، الصفقة التجارية، والاختصاص. سنقيّم الاكتمال، وتوازن المخاطر، والقابلية للتنفيذ لمساعدتك على اكتشاف الثغرات قبل الصياغة.',
      inputLabel: 'مستندك وما يجب أن يغطّيه',
      inputPlaceholder: 'عقد خدمات بين استوديو التصميم الخاص بي وعميل SaaS في مرحلة B للارتباط لمدة 6 أشهر بقيمة 18 ألف دولار/شهر، يخضع للقانون الأسترالي…',
      buttonLabel: 'تحقّق من مستندي القانوني',
    },
    technical: {
      intro: 'صِف المستند التقني — المنتج، الجمهور، والمشكلة التي يحلّها للقرّاء. سنقيّم مدى مطابقته لاحتياجات المطوّرين وقابليته للاكتشاف.',
      inputLabel: 'فكرة مستندك التقني',
      inputPlaceholder: 'دليل بدء للمطوّرين الذين يدمجون قاعدة بيانات Lunar التحليلية. القارئ المستهدف: مهندسو الخلفية الذين يتمتّعون بخبرة في Postgres…',
      buttonLabel: 'تحقّق من مستندي التقني',
    },
    reference: {
      intro: 'صِف فكرة كتاب الطهي أو الدليل — الموضوع، الجمهور، والزاوية. سنقيّم مدى تميّزه في نوع مزدحم ومن سيعود إليه مرّة بعد مرّة.',
      inputLabel: 'فكرتك',
      inputPlaceholder: 'كتاب طهي يضم 50 وجبة عشاء بقدر واحد للآباء العاملين، تركّز على وجبات بـ 30 دقيقة بمكوّنات المخزن…',
      buttonLabel: 'تحقّق من فكرتي',
    },
    shortForm: {
      intro: 'صِف القطعة — الفكرة، الشكل، الصوت. سنقيّم إمكاناتها الحرفية وأين يمكن أن تُنشر.',
      inputLabel: 'فكرتك',
      inputPlaceholder: 'مجموعة من 40 قصيدة شعر حر عن الهجرة، تُروى عبر ثلاثة أجيال من النساء في عائلة واحدة…',
      buttonLabel: 'تحقّق من فكرتي',
    },
  },
  es: {
    narrative: {
      intro: 'Describe tu idea de libro — el tema, para quién es, y qué tiene de nuevo tu ángulo. Estimaremos la demanda del mercado, el ajuste con la audiencia y dónde posicionarlo para ayudarte a decidir.',
      inputLabel: 'Tu idea de libro',
      inputPlaceholder: 'Una guía práctica para fundadores primerizos en el sudeste asiático sobre recaudar capital semilla sin una red en EE. UU. Mi ángulo es…',
      buttonLabel: 'Validar mi idea de libro',
    },
    businessPlan: {
      intro: 'Describe el negocio y para qué es este plan. Evaluaremos la oportunidad de mercado, la defensibilidad y si el plan está listo para inversores, para ayudarte a fortalecerlo antes de presentarlo.',
      inputLabel: 'Tu idea de negocio',
      inputPlaceholder: 'Un SaaS de gestión de inventario por suscripción para minoristas independientes en el sudeste asiático. Vendemos a dueños de 10-50 tiendas a $89/mes. Nuestro foso es…',
      buttonLabel: 'Validar mi idea de negocio',
    },
    proposal: {
      intro: 'Describe la propuesta — qué propones, a quién, y qué quieres que aprueben. Evaluaremos la claridad, la alineación de valor y la capacidad de persuasión para ayudarte a conseguir el sí.',
      inputLabel: 'Tu idea de propuesta',
      inputPlaceholder: 'Un compromiso de consultoría de 6 meses para rediseñar el sistema de adquisiciones de Acme Corp, presentado a su jefe de operaciones por $180K…',
      buttonLabel: 'Validar mi propuesta',
    },
    academic: {
      intro: 'Describe la pregunta de investigación y qué tiene de nuevo el enfoque. Evaluaremos la novedad, la idoneidad metodológica y la recepción probable en tu campo, para ayudarte a dar forma a un trabajo defendible.',
      inputLabel: 'Tu tema de investigación',
      inputPlaceholder: 'Un estudio de métodos mixtos sobre cómo el trabajo remoto afecta la retención de ingenieros de carrera temprana en empresas tecnológicas medianas, con N=300 encuestas + 40 entrevistas…',
      buttonLabel: 'Validar mi idea de investigación',
    },
    legal: {
      intro: 'Describe el documento legal que necesitas — las partes, el acuerdo comercial y la jurisdicción. Evaluaremos la exhaustividad, el balance de riesgos y la exigibilidad para ayudarte a detectar vacíos antes de redactar.',
      inputLabel: 'Tu documento y lo que debe cubrir',
      inputPlaceholder: 'Contrato de servicios entre mi estudio de diseño y un cliente SaaS Serie B para un compromiso de 6 meses a $18K/mes, regido por la ley australiana…',
      buttonLabel: 'Revisar mi documento legal',
    },
    technical: {
      intro: 'Describe el documento técnico — producto, audiencia y el problema que resuelve para los lectores. Evaluaremos si coincide con las necesidades de desarrolladores y qué tan detectable será.',
      inputLabel: 'Tu idea de documento técnico',
      inputPlaceholder: 'Una guía de inicio para desarrolladores que integran la base de datos analítica de Lunar. Lector objetivo: ingenieros backend con experiencia en Postgres…',
      buttonLabel: 'Validar mi documento técnico',
    },
    reference: {
      intro: 'Describe tu idea de libro de cocina o guía — el tema, la audiencia y el gancho. Evaluaremos qué tan bien destaca en un género saturado y quién lo tendrá a mano una y otra vez.',
      inputLabel: 'Tu idea',
      inputPlaceholder: 'Un libro de cocina con 50 cenas de una sola olla entre semana para padres trabajadores, centrado en comidas de 30 minutos con ingredientes de despensa…',
      buttonLabel: 'Validar mi idea',
    },
    shortForm: {
      intro: 'Describe la pieza — tema, forma, voz. Evaluaremos el potencial artesanal y dónde podría aterrizar para publicación.',
      inputLabel: 'Tu idea',
      inputPlaceholder: 'Una colección de 40 poemas en verso libre sobre migración, contados a través de tres generaciones de mujeres de una misma familia…',
      buttonLabel: 'Validar mi idea',
    },
  },
  fr: {
    narrative: {
      intro: 'Décrivez votre idée de livre — le sujet, son public et ce qui est nouveau dans votre angle. Nous estimerons la demande du marché, l’adéquation avec le lectorat et le positionnement pour vous aider à décider.',
      inputLabel: 'Votre idée de livre',
      inputPlaceholder: 'Un guide pratique pour les primo-fondateurs d’Asie du Sud-Est sur la levée de fonds d’amorçage sans réseau américain. Mon angle est…',
      buttonLabel: 'Valider mon idée de livre',
    },
    businessPlan: {
      intro: 'Décrivez l’entreprise et à quoi sert ce plan. Nous évaluerons l’opportunité de marché, la défensabilité et si le plan est prêt pour les investisseurs, afin de vous aider à le renforcer avant de le présenter.',
      inputLabel: 'Votre idée d’entreprise',
      inputPlaceholder: 'Un SaaS de gestion de stock par abonnement pour les détaillants indépendants d’Asie du Sud-Est. Nous vendons à des propriétaires de 10 à 50 magasins pour 89 $/mois. Notre avantage défensif est…',
      buttonLabel: 'Valider mon idée d’entreprise',
    },
    proposal: {
      intro: 'Décrivez la proposition — ce que vous proposez, à qui, et ce que vous voulez faire approuver. Nous évaluerons la clarté, l’alignement de la valeur et le pouvoir de persuasion pour vous aider à obtenir le oui.',
      inputLabel: 'Votre idée de proposition',
      inputPlaceholder: 'Une mission de conseil de 6 mois pour revoir le système d’achats d’Acme Corp, proposée à leur directeur des opérations pour 180 k$…',
      buttonLabel: 'Valider ma proposition',
    },
    academic: {
      intro: 'Décrivez la question de recherche et ce qui est nouveau dans l’approche. Nous évaluerons la nouveauté, l’adéquation méthodologique et la réception probable dans votre domaine pour vous aider à bâtir un article défendable.',
      inputLabel: 'Votre sujet de recherche',
      inputPlaceholder: 'Une étude à méthodes mixtes sur l’effet du télétravail sur la rétention des ingénieurs en début de carrière dans les entreprises tech de taille moyenne, avec N=300 sondage + 40 entretiens…',
      buttonLabel: 'Valider mon idée de recherche',
    },
    legal: {
      intro: 'Décrivez le document juridique dont vous avez besoin — les parties, l’accord commercial et la juridiction. Nous évaluerons l’exhaustivité, l’équilibre des risques et la force exécutoire pour vous aider à repérer les lacunes avant la rédaction.',
      inputLabel: 'Votre document et ce qu’il doit couvrir',
      inputPlaceholder: 'Contrat de services entre mon studio de design et un client SaaS en série B pour une mission de 6 mois à 18 k$/mois, régi par le droit australien…',
      buttonLabel: 'Vérifier mon document juridique',
    },
    technical: {
      intro: 'Décrivez le document technique — produit, public et problème qu’il résout pour les lecteurs. Nous évaluerons s’il correspond aux besoins des développeurs et à quel point il sera trouvable.',
      inputLabel: 'Votre idée de doc technique',
      inputPlaceholder: 'Un guide de démarrage pour les développeurs intégrant la base de données analytique Lunar. Lecteur cible : ingénieurs backend avec expérience Postgres…',
      buttonLabel: 'Valider mon doc technique',
    },
    reference: {
      intro: 'Décrivez votre idée de livre de cuisine ou de guide — le sujet, le public et l’accroche. Nous évaluerons à quel point il se démarque dans un genre saturé et qui y reviendra encore et encore.',
      inputLabel: 'Votre idée',
      inputPlaceholder: 'Un livre de cuisine de 50 dîners de semaine en un seul plat pour parents actifs, axé sur des repas de 30 minutes avec des ingrédients du garde-manger…',
      buttonLabel: 'Valider mon idée',
    },
    shortForm: {
      intro: 'Décrivez la pièce — thème, forme, voix. Nous évaluerons le potentiel artisanal et où elle pourrait trouver sa place en publication.',
      inputLabel: 'Votre idée',
      inputPlaceholder: 'Un recueil de 40 poèmes en vers libres sur la migration, racontés à travers trois générations de femmes d’une même famille…',
      buttonLabel: 'Valider mon idée',
    },
  },
  pt: {
    narrative: {
      intro: 'Descreva sua ideia de livro — o tema, para quem é e o que há de novo no seu ângulo. Estimaremos a demanda de mercado, o encaixe com o público e onde posicioná-lo para ajudá-lo a decidir.',
      inputLabel: 'Sua ideia de livro',
      inputPlaceholder: 'Um guia prático para fundadores iniciantes no sudeste asiático sobre levantar capital semente sem uma rede nos EUA. Meu ângulo é…',
      buttonLabel: 'Validar minha ideia de livro',
    },
    businessPlan: {
      intro: 'Descreva o negócio e para que serve este plano. Avaliaremos a oportunidade de mercado, a defensibilidade e se o plano está pronto para investidores, para ajudá-lo a fortalecê-lo antes de apresentar.',
      inputLabel: 'Sua ideia de negócio',
      inputPlaceholder: 'Um SaaS de gestão de estoque por assinatura para varejistas independentes no sudeste asiático. Vendemos para donos de 10-50 lojas por $89/mês. Nosso diferencial é…',
      buttonLabel: 'Validar minha ideia de negócio',
    },
    proposal: {
      intro: 'Descreva a proposta — o que você propõe, para quem e o que quer que aprovem. Avaliaremos clareza, alinhamento de valor e poder de persuasão para ajudá-lo a ganhar o sim.',
      inputLabel: 'Sua ideia de proposta',
      inputPlaceholder: 'Uma consultoria de 6 meses para reformular o sistema de compras da Acme Corp, apresentada ao Chefe de Operações por $180K…',
      buttonLabel: 'Validar minha proposta',
    },
    academic: {
      intro: 'Descreva a questão de pesquisa e o que há de novo na abordagem. Avaliaremos novidade, adequação metodológica e recepção provável no seu campo para ajudá-lo a moldar um artigo defensável.',
      inputLabel: 'Seu tópico de pesquisa',
      inputPlaceholder: 'Um estudo de métodos mistos sobre como o trabalho remoto afeta a retenção de engenheiros em início de carreira em empresas de tecnologia de médio porte, com N=300 pesquisa + 40 entrevistas…',
      buttonLabel: 'Validar minha ideia de pesquisa',
    },
    legal: {
      intro: 'Descreva o documento legal necessário — as partes, o acordo comercial e a jurisdição. Avaliaremos completude, equilíbrio de risco e exequibilidade para ajudá-lo a detectar lacunas antes de redigir.',
      inputLabel: 'Seu documento e o que precisa cobrir',
      inputPlaceholder: 'Contrato de serviços entre meu estúdio de design e um cliente SaaS Série B para engajamento de 6 meses a $18K/mês, regido pela lei australiana…',
      buttonLabel: 'Verificar meu documento legal',
    },
    technical: {
      intro: 'Descreva o documento técnico — produto, público e o problema que resolve para os leitores. Avaliaremos se corresponde às necessidades dos desenvolvedores e quão descobrível ele será.',
      inputLabel: 'Sua ideia de documento técnico',
      inputPlaceholder: 'Um guia de início para desenvolvedores integrando o banco de dados analítico da Lunar. Leitor-alvo: engenheiros de backend com experiência em Postgres…',
      buttonLabel: 'Validar meu documento técnico',
    },
    reference: {
      intro: 'Descreva sua ideia de livro de receitas ou guia — o tema, público e o gancho. Avaliaremos quão bem ele se destaca num gênero saturado e quem o consultará repetidas vezes.',
      inputLabel: 'Sua ideia',
      inputPlaceholder: 'Um livro de receitas com 50 jantares de panela única para pais que trabalham, focado em refeições de 30 minutos com itens da despensa…',
      buttonLabel: 'Validar minha ideia',
    },
    shortForm: {
      intro: 'Descreva a peça — tema, forma, voz. Avaliaremos potencial artesanal e onde poderia ser publicada.',
      inputLabel: 'Sua ideia',
      inputPlaceholder: 'Uma coletânea de 40 poemas em verso livre sobre migração, contados através de três gerações de mulheres de uma mesma família…',
      buttonLabel: 'Validar minha ideia',
    },
  },
  ru: {
    narrative: {
      intro: 'Опишите идею вашей книги — тему, для кого она, и что нового в вашем ракурсе. Мы оценим рыночный спрос, соответствие аудитории и позиционирование, чтобы помочь вам принять решение.',
      inputLabel: 'Ваша идея книги',
      inputPlaceholder: 'Практическое руководство для начинающих основателей из Юго-Восточной Азии о привлечении посевного капитала без американской сети. Мой ракурс — …',
      buttonLabel: 'Проверить мою идею книги',
    },
    businessPlan: {
      intro: 'Опишите бизнес и для чего этот план. Мы оценим рыночную возможность, защищённость и инвестиционную готовность плана, чтобы помочь вам усилить его перед презентацией.',
      inputLabel: 'Ваша бизнес-идея',
      inputPlaceholder: 'SaaS по подписке для управления запасами для независимых ритейлеров Юго-Восточной Азии. Продаём владельцам 10–50 магазинов по $89/мес. Наш ров — …',
      buttonLabel: 'Проверить мою бизнес-идею',
    },
    proposal: {
      intro: 'Опишите предложение — что вы предлагаете, кому, и что хотите, чтобы они одобрили. Мы оценим ясность, соответствие ценности и убедительность, чтобы помочь вам получить «да».',
      inputLabel: 'Ваша идея предложения',
      inputPlaceholder: 'Консалтинговая работа на 6 месяцев по перестройке системы закупок Acme Corp, предлагаемая их директору по операциям за $180K…',
      buttonLabel: 'Проверить моё предложение',
    },
    academic: {
      intro: 'Опишите исследовательский вопрос и что нового в подходе. Мы оценим новизну, методологическую уместность и вероятную рецепцию в вашей области, чтобы помочь вам сформировать защитимую работу.',
      inputLabel: 'Ваша тема исследования',
      inputPlaceholder: 'Исследование смешанных методов о влиянии удалённой работы на удержание инженеров в начале карьеры в средних технологических компаниях, N=300 опрос + 40 интервью…',
      buttonLabel: 'Проверить мою исследовательскую идею',
    },
    legal: {
      intro: 'Опишите нужный юридический документ — стороны, коммерческую сделку и юрисдикцию. Мы оценим полноту, баланс рисков и исполнимость, чтобы помочь вам выявить пробелы до составления.',
      inputLabel: 'Ваш документ и что он должен охватить',
      inputPlaceholder: 'Договор услуг между моей дизайн-студией и клиентом-SaaS серии B на 6-месячную работу по $18K/мес, регулируемый австралийским правом…',
      buttonLabel: 'Проверить мой юридический документ',
    },
    technical: {
      intro: 'Опишите технический документ — продукт, аудиторию и проблему, которую он решает для читателей. Мы оценим соответствие потребностям разработчиков и то, насколько он будет находим.',
      inputLabel: 'Ваша идея технического документа',
      inputPlaceholder: 'Руководство по началу работы для разработчиков, интегрирующих аналитическую базу данных Lunar. Целевой читатель: backend-инженеры с опытом Postgres…',
      buttonLabel: 'Проверить мой технический документ',
    },
    reference: {
      intro: 'Опишите идею вашей кулинарной книги или руководства — тему, аудиторию и «крючок». Мы оценим, насколько она выделяется в перенасыщенном жанре и кто будет возвращаться к ней снова и снова.',
      inputLabel: 'Ваша идея',
      inputPlaceholder: 'Кулинарная книга из 50 рецептов ужинов в одной кастрюле для работающих родителей, с фокусом на 30-минутных блюдах из продуктов кладовой…',
      buttonLabel: 'Проверить мою идею',
    },
    shortForm: {
      intro: 'Опишите произведение — тему, форму, голос. Мы оценим ремесленный потенциал и где оно могло бы найти место для публикации.',
      inputLabel: 'Ваша идея',
      inputPlaceholder: 'Сборник из 40 стихотворений свободного стиха о миграции, рассказанных через три поколения женщин одной семьи…',
      buttonLabel: 'Проверить мою идею',
    },
  },
  zh: {
    narrative: {
      intro: '描述您的书籍创意 — 主题、目标读者,以及您角度的新意之处。我们将估算市场需求、读者契合度和定位策略,帮您做出决定。',
      inputLabel: '您的书籍创意',
      inputPlaceholder: '一本实用指南,帮助东南亚首次创业者在没有美国网络的情况下筹集种子资金。我的切入点是…',
      buttonLabel: '验证我的书籍创意',
    },
    businessPlan: {
      intro: '描述该业务和本计划的用途。我们将评估市场机会、防御力,以及该计划是否已为投资者准备就绪,帮您在陈述前强化它。',
      inputLabel: '您的业务创意',
      inputPlaceholder: '一款面向东南亚独立零售商的订阅制库存管理SaaS。我们以每月$89的价格销售给10-50家店主。我们的护城河是…',
      buttonLabel: '验证我的业务创意',
    },
    proposal: {
      intro: '描述该提案 — 您提出的内容、对象,以及希望对方批准的事项。我们将评估清晰度、价值契合度和说服力,帮您赢得同意。',
      inputLabel: '您的提案创意',
      inputPlaceholder: '为期6个月的咨询合作,重整Acme公司的采购系统,提交给他们的运营主管,报价$180K…',
      buttonLabel: '验证我的提案',
    },
    academic: {
      intro: '描述研究问题及该方法的新颖之处。我们将评估创新性、方法契合度,以及您所在领域可能的接受度,帮您塑造一篇可辩护的论文。',
      inputLabel: '您的研究主题',
      inputPlaceholder: '一项混合方法研究,探讨远程工作如何影响中型科技公司早期职业工程师的留任,采用N=300问卷+40次访谈…',
      buttonLabel: '验证我的研究创意',
    },
    legal: {
      intro: '描述所需的法律文件 — 各方、商业交易和司法管辖区。我们将评估完整性、风险平衡和可执行性,帮您在起草前发现漏洞。',
      inputLabel: '您的文件及应覆盖的内容',
      inputPlaceholder: '我的设计工作室与B轮SaaS客户之间的服务合同,为期6个月、每月$18K,受澳大利亚法律管辖…',
      buttonLabel: '检查我的法律文件',
    },
    technical: {
      intro: '描述该技术文档 — 产品、受众,以及为读者解决的问题。我们将评估它是否符合开发者需求及其可发现性。',
      inputLabel: '您的技术文档创意',
      inputPlaceholder: '为集成Lunar分析数据库的开发者准备的入门指南。目标读者:具有Postgres经验的后端工程师…',
      buttonLabel: '验证我的技术文档',
    },
    reference: {
      intro: '描述您的食谱或指南创意 — 主题、受众和亮点。我们将评估它在竞争激烈的类别中的突出程度,以及谁会一再翻阅它。',
      inputLabel: '您的创意',
      inputPlaceholder: '一本包含50道一锅搞定周间晚餐的食谱,面向工作中的父母,专注于使用储藏室食材的30分钟菜式…',
      buttonLabel: '验证我的创意',
    },
    shortForm: {
      intro: '描述该作品 — 主题、形式、语调。我们将评估其工艺潜力以及可能的出版去向。',
      inputLabel: '您的创意',
      inputPlaceholder: '一本40首自由体诗集,关于移民,通过一个家庭三代女性的视角讲述…',
      buttonLabel: '验证我的创意',
    },
  },
  bn: {
    narrative: {
      intro: 'আপনার বইয়ের আইডিয়া বর্ণনা করুন — বিষয়, কার জন্য এবং আপনার দৃষ্টিকোণের নতুনত্ব কী। আমরা বাজারের চাহিদা, শ্রোতার মিল এবং অবস্থান মূল্যায়ন করে আপনাকে সিদ্ধান্তে সাহায্য করব।',
      inputLabel: 'আপনার বইয়ের আইডিয়া',
      inputPlaceholder: 'দক্ষিণ-পূর্ব এশিয়ার প্রথমবারের মতো প্রতিষ্ঠাতাদের জন্য মার্কিন নেটওয়ার্ক ছাড়াই সিড ক্যাপিটাল সংগ্রহের একটি ব্যবহারিক গাইড। আমার দৃষ্টিকোণ হলো…',
      buttonLabel: 'আমার বইয়ের আইডিয়া যাচাই করুন',
    },
    businessPlan: {
      intro: 'ব্যবসা এবং এই পরিকল্পনার উদ্দেশ্য বর্ণনা করুন। আমরা বাজার সুযোগ, প্রতিরক্ষাক্ষমতা, এবং পরিকল্পনা বিনিয়োগকারী-প্রস্তুত কিনা তা মূল্যায়ন করব, যাতে উপস্থাপনের আগে আপনি এটি শক্তিশালী করতে পারেন।',
      inputLabel: 'আপনার ব্যবসার আইডিয়া',
      inputPlaceholder: 'দক্ষিণ-পূর্ব এশিয়ার স্বাধীন খুচরা বিক্রেতাদের জন্য একটি সাবস্ক্রিপশন ইনভেন্টরি-ম্যানেজমেন্ট SaaS। আমরা 10-50 দোকানের মালিকদের কাছে $89/মাসে বিক্রি করি। আমাদের সুবিধা হলো…',
      buttonLabel: 'আমার ব্যবসার আইডিয়া যাচাই করুন',
    },
    proposal: {
      intro: 'প্রস্তাবটি বর্ণনা করুন — আপনি কী প্রস্তাব করছেন, কাকে, এবং তাদের কী অনুমোদন করতে চান। আমরা স্পষ্টতা, মূল্য সারিবদ্ধতা এবং প্ররোচনাশক্তি মূল্যায়ন করে আপনাকে হ্যাঁ জিততে সাহায্য করব।',
      inputLabel: 'আপনার প্রস্তাব আইডিয়া',
      inputPlaceholder: 'Acme কর্পোরেশনের সংগ্রহ সিস্টেম পুনর্গঠনের জন্য 6 মাসের পরামর্শ চুক্তি, তাদের অপারেশন প্রধানের কাছে $180K-এ প্রস্তাবিত…',
      buttonLabel: 'আমার প্রস্তাব যাচাই করুন',
    },
    academic: {
      intro: 'গবেষণা প্রশ্ন এবং পদ্ধতির নতুনত্ব বর্ণনা করুন। আমরা নতুনত্ব, পদ্ধতিগত উপযুক্ততা এবং আপনার ক্ষেত্রে সম্ভাব্য গ্রহণযোগ্যতা মূল্যায়ন করব, যাতে আপনি একটি প্রতিরক্ষাযোগ্য গবেষণাপত্র গঠন করতে পারেন।',
      inputLabel: 'আপনার গবেষণার বিষয়',
      inputPlaceholder: 'মাঝারি আকারের প্রযুক্তি সংস্থায় প্রাথমিক ক্যারিয়ারের প্রকৌশলীদের উপর দূরবর্তী কাজের প্রভাবের একটি মিশ্র-পদ্ধতি অধ্যয়ন, N=300 সমীক্ষা + 40 সাক্ষাৎকার…',
      buttonLabel: 'আমার গবেষণা আইডিয়া যাচাই করুন',
    },
    legal: {
      intro: 'আপনার প্রয়োজনীয় আইনি নথি বর্ণনা করুন — পক্ষগুলি, বাণিজ্যিক চুক্তি এবং এখতিয়ার। আমরা সম্পূর্ণতা, ঝুঁকি ভারসাম্য এবং বলবৎযোগ্যতা মূল্যায়ন করে খসড়ার আগে ফাঁক চিহ্নিত করতে সাহায্য করব।',
      inputLabel: 'আপনার নথি ও এতে যা কভার করা দরকার',
      inputPlaceholder: 'আমার ডিজাইন স্টুডিও এবং একটি সিরিজ B SaaS ক্লায়েন্টের মধ্যে 6 মাসের চুক্তি, $18K/মাসে, অস্ট্রেলিয়ান আইন দ্বারা পরিচালিত…',
      buttonLabel: 'আমার আইনি নথি পরীক্ষা করুন',
    },
    technical: {
      intro: 'প্রযুক্তিগত নথি বর্ণনা করুন — পণ্য, শ্রোতা এবং পাঠকদের জন্য এটি যে সমস্যা সমাধান করে। আমরা এটি ডেভেলপারদের প্রয়োজনের সাথে মেলে কিনা এবং কতটা আবিষ্কারযোগ্য হবে তা মূল্যায়ন করব।',
      inputLabel: 'আপনার প্রযুক্তিগত নথির আইডিয়া',
      inputPlaceholder: 'Lunar-এর বিশ্লেষণাত্মক ডেটাবেস সংহতকারী ডেভেলপারদের জন্য একটি শুরুর গাইড। লক্ষ্য পাঠক: Postgres অভিজ্ঞতা সম্পন্ন ব্যাকএন্ড প্রকৌশলী…',
      buttonLabel: 'আমার প্রযুক্তিগত নথি যাচাই করুন',
    },
    reference: {
      intro: 'আপনার রান্নার বই বা গাইডের আইডিয়া বর্ণনা করুন — বিষয়, শ্রোতা এবং আকর্ষণ। আমরা ব্যস্ত ধারায় এটি কতটা আলাদা হবে এবং কে বারবার এটিতে ফিরে আসবে তা মূল্যায়ন করব।',
      inputLabel: 'আপনার আইডিয়া',
      inputPlaceholder: 'কর্মজীবী পিতামাতার জন্য এক-পাত্রের 50টি সাপ্তাহিক নৈশভোজের একটি রান্নার বই, প্যান্ট্রি উপাদান দিয়ে 30-মিনিটের খাবারে ফোকাস…',
      buttonLabel: 'আমার আইডিয়া যাচাই করুন',
    },
    shortForm: {
      intro: 'টুকরোটি বর্ণনা করুন — থিম, রূপ, কণ্ঠস্বর। আমরা কারুকাজের সম্ভাবনা এবং এটি কোথায় প্রকাশনার জন্য জায়গা পেতে পারে তা মূল্যায়ন করব।',
      inputLabel: 'আপনার আইডিয়া',
      inputPlaceholder: 'অভিবাসন সম্পর্কে 40টি মুক্ত-ছন্দ কবিতার সংগ্রহ, এক পরিবারের তিন প্রজন্মের নারীর মধ্য দিয়ে বর্ণিত…',
      buttonLabel: 'আমার আইডিয়া যাচাই করুন',
    },
  },
  hi: {
    narrative: {
      intro: 'अपनी पुस्तक के विचार का वर्णन करें — विषय, किसके लिए है, और आपके दृष्टिकोण में क्या नया है। हम बाज़ार की माँग, दर्शकों के साथ मेल और स्थिति का अनुमान लगाकर आपको निर्णय लेने में मदद करेंगे।',
      inputLabel: 'आपकी पुस्तक का विचार',
      inputPlaceholder: 'दक्षिण-पूर्व एशिया में पहली बार के संस्थापकों के लिए अमेरिकी नेटवर्क के बिना सीड पूंजी जुटाने पर एक व्यावहारिक गाइड। मेरा दृष्टिकोण है…',
      buttonLabel: 'मेरी पुस्तक के विचार को मान्य करें',
    },
    businessPlan: {
      intro: 'व्यवसाय और इस योजना का उद्देश्य बताएँ। हम बाज़ार अवसर, रक्षात्मकता और क्या योजना निवेशक-तैयार है, इसका मूल्यांकन करेंगे, ताकि प्रस्तुति से पहले आप इसे मज़बूत कर सकें।',
      inputLabel: 'आपका व्यावसायिक विचार',
      inputPlaceholder: 'दक्षिण-पूर्व एशिया के स्वतंत्र खुदरा विक्रेताओं के लिए एक सदस्यता इन्वेंटरी-प्रबंधन SaaS। हम 10-50 दुकान मालिकों को $89/माह पर बेचते हैं। हमारी खाई है…',
      buttonLabel: 'मेरे व्यावसायिक विचार को मान्य करें',
    },
    proposal: {
      intro: 'प्रस्ताव का वर्णन करें — आप क्या प्रस्तावित कर रहे हैं, किसे, और क्या स्वीकृति चाहते हैं। हम स्पष्टता, मूल्य संरेखण और प्रेरकता का मूल्यांकन करेंगे ताकि आप हाँ जीत सकें।',
      inputLabel: 'आपका प्रस्ताव विचार',
      inputPlaceholder: 'Acme Corp की खरीद प्रणाली के पुनर्गठन के लिए 6-माह की परामर्श सगाई, उनके संचालन प्रमुख को $180K के लिए प्रस्तुत…',
      buttonLabel: 'मेरे प्रस्ताव को मान्य करें',
    },
    academic: {
      intro: 'शोध प्रश्न और दृष्टिकोण में नयापन बताएँ। हम नवीनता, पद्धतिगत उपयुक्तता और आपके क्षेत्र में संभावित स्वागत का मूल्यांकन करेंगे, ताकि आप एक बचाव योग्य पेपर गढ़ सकें।',
      inputLabel: 'आपका शोध विषय',
      inputPlaceholder: 'मध्यम आकार की तकनीकी फर्मों में प्रारंभिक करियर इंजीनियर प्रतिधारण पर रिमोट कार्य के प्रभाव का एक मिश्रित-विधि अध्ययन, N=300 सर्वेक्षण + 40 साक्षात्कार का उपयोग करते हुए…',
      buttonLabel: 'मेरे शोध विचार को मान्य करें',
    },
    legal: {
      intro: 'आपको जिस कानूनी दस्तावेज़ की आवश्यकता है उसका वर्णन करें — पक्ष, वाणिज्यिक सौदा और अधिकार क्षेत्र। हम पूर्णता, जोखिम संतुलन और प्रवर्तनीयता का मूल्यांकन करेंगे ताकि मसौदा तैयार करने से पहले आप कमियाँ पहचान सकें।',
      inputLabel: 'आपका दस्तावेज़ और इसे क्या कवर करना चाहिए',
      inputPlaceholder: 'मेरे डिज़ाइन स्टूडियो और एक सीरीज़ B SaaS क्लाइंट के बीच 6-माह की सगाई के लिए सेवा अनुबंध, $18K/माह पर, ऑस्ट्रेलियाई कानून द्वारा शासित…',
      buttonLabel: 'मेरे कानूनी दस्तावेज़ की जाँच करें',
    },
    technical: {
      intro: 'तकनीकी दस्तावेज़ का वर्णन करें — उत्पाद, दर्शक और यह पाठकों के लिए कौन सी समस्या हल करता है। हम मूल्यांकन करेंगे कि यह डेवलपर आवश्यकताओं से मेल खाता है या नहीं और कितना खोजने योग्य होगा।',
      inputLabel: 'आपका तकनीकी दस्तावेज़ विचार',
      inputPlaceholder: 'Lunar के विश्लेषणात्मक डेटाबेस को एकीकृत करने वाले डेवलपर्स के लिए एक शुरुआती गाइड। लक्ष्य पाठक: Postgres अनुभव वाले बैकएंड इंजीनियर…',
      buttonLabel: 'मेरे तकनीकी दस्तावेज़ को मान्य करें',
    },
    reference: {
      intro: 'अपनी कुकबुक या गाइड के विचार का वर्णन करें — विषय, दर्शक और हुक। हम मूल्यांकन करेंगे कि यह भीड़भाड़ वाली शैली में कितनी अच्छी तरह खड़ा होता है और कौन बार-बार इसे उठाएगा।',
      inputLabel: 'आपका विचार',
      inputPlaceholder: 'कार्यरत माता-पिता के लिए 50 एक-बर्तन सप्ताहांत रात्रिभोज की एक कुकबुक, पेंट्री सामग्री के साथ 30-मिनट के भोजन पर केंद्रित…',
      buttonLabel: 'मेरे विचार को मान्य करें',
    },
    shortForm: {
      intro: 'टुकड़े का वर्णन करें — विषय, रूप, आवाज़। हम शिल्प क्षमता और यह प्रकाशन के लिए कहाँ जा सकता है, इसका मूल्यांकन करेंगे।',
      inputLabel: 'आपका विचार',
      inputPlaceholder: 'प्रवास के बारे में 40 मुक्त-छंद कविताओं का संग्रह, एक परिवार की तीन पीढ़ियों की महिलाओं के माध्यम से बताया गया…',
      buttonLabel: 'मेरे विचार को मान्य करें',
    },
  },
  id: {
    narrative: {
      intro: 'Jelaskan ide buku Anda — topiknya, untuk siapa, dan apa yang baru dari sudut pandang Anda. Kami akan memperkirakan permintaan pasar, kecocokan audiens, dan posisi untuk membantu Anda memutuskan.',
      inputLabel: 'Ide buku Anda',
      inputPlaceholder: 'Panduan praktis untuk pendiri pertama kali di Asia Tenggara tentang mengumpulkan modal seed tanpa jaringan AS. Sudut pandang saya adalah…',
      buttonLabel: 'Validasi ide buku saya',
    },
    businessPlan: {
      intro: 'Jelaskan bisnis dan untuk apa rencana ini. Kami akan mengevaluasi peluang pasar, daya tahan, dan apakah rencana siap untuk investor, untuk membantu Anda memperkuatnya sebelum presentasi.',
      inputLabel: 'Ide bisnis Anda',
      inputPlaceholder: 'SaaS manajemen inventaris berlangganan untuk pengecer independen di Asia Tenggara. Kami menjual ke pemilik 10-50 toko seharga $89/bulan. Keunggulan kami adalah…',
      buttonLabel: 'Validasi ide bisnis saya',
    },
    proposal: {
      intro: 'Jelaskan proposal — apa yang Anda tawarkan, kepada siapa, dan apa yang Anda ingin mereka setujui. Kami akan menilai kejelasan, keselarasan nilai, dan daya persuasi untuk membantu Anda mendapatkan persetujuan.',
      inputLabel: 'Ide proposal Anda',
      inputPlaceholder: 'Perjanjian konsultasi 6 bulan untuk merombak sistem pengadaan Acme Corp, dipresentasikan kepada Kepala Operasi mereka seharga $180K…',
      buttonLabel: 'Validasi proposal saya',
    },
    academic: {
      intro: 'Jelaskan pertanyaan penelitian dan apa yang baru dari pendekatannya. Kami akan menilai kebaruan, kesesuaian metodologi, dan kemungkinan penerimaan di bidang Anda untuk membantu Anda menyusun paper yang dapat dipertahankan.',
      inputLabel: 'Topik penelitian Anda',
      inputPlaceholder: 'Studi metode campuran tentang bagaimana kerja jarak jauh memengaruhi retensi insinyur awal karir di perusahaan teknologi menengah, menggunakan N=300 survei + 40 wawancara…',
      buttonLabel: 'Validasi ide penelitian saya',
    },
    legal: {
      intro: 'Jelaskan dokumen hukum yang Anda butuhkan — pihak, kesepakatan komersial, dan yurisdiksi. Kami akan menilai kelengkapan, keseimbangan risiko, dan keberlakuan untuk membantu Anda menemukan celah sebelum menyusun.',
      inputLabel: 'Dokumen Anda dan apa yang perlu dicakupnya',
      inputPlaceholder: 'Kontrak layanan antara studio desain saya dan klien SaaS Seri B untuk engagement 6 bulan seharga $18K/bulan, diatur oleh hukum Australia…',
      buttonLabel: 'Periksa dokumen hukum saya',
    },
    technical: {
      intro: 'Jelaskan dokumen teknis — produk, audiens, dan masalah yang diselesaikan untuk pembaca. Kami akan menilai apakah sesuai dengan kebutuhan developer dan seberapa mudah ditemukan.',
      inputLabel: 'Ide dokumen teknis Anda',
      inputPlaceholder: 'Panduan memulai untuk developer yang mengintegrasikan database analitis Lunar. Pembaca target: insinyur backend dengan pengalaman Postgres…',
      buttonLabel: 'Validasi dokumen teknis saya',
    },
    reference: {
      intro: 'Jelaskan ide buku masak atau panduan Anda — topik, audiens, dan daya tariknya. Kami akan menilai seberapa menonjol di genre yang ramai dan siapa yang akan kembali lagi dan lagi.',
      inputLabel: 'Ide Anda',
      inputPlaceholder: 'Buku masak 50 makan malam satu panci untuk orang tua bekerja, berfokus pada hidangan 30 menit dengan bahan pantry…',
      buttonLabel: 'Validasi ide saya',
    },
    shortForm: {
      intro: 'Jelaskan karyanya — tema, bentuk, suara. Kami akan menilai potensi kerajinan dan ke mana bisa diterbitkan.',
      inputLabel: 'Ide Anda',
      inputPlaceholder: 'Kumpulan 40 puisi syair bebas tentang migrasi, diceritakan melalui tiga generasi perempuan dalam satu keluarga…',
      buttonLabel: 'Validasi ide saya',
    },
  },
  vi: {
    narrative: {
      intro: 'Mô tả ý tưởng sách của bạn — chủ đề, dành cho ai, và điểm mới trong góc nhìn của bạn. Chúng tôi sẽ ước tính nhu cầu thị trường, phù hợp với đối tượng, và vị trí để giúp bạn quyết định.',
      inputLabel: 'Ý tưởng sách của bạn',
      inputPlaceholder: 'Hướng dẫn thực tiễn cho các nhà sáng lập lần đầu ở Đông Nam Á về việc gọi vốn hạt giống mà không có mạng lưới ở Mỹ. Góc nhìn của tôi là…',
      buttonLabel: 'Xác thực ý tưởng sách của tôi',
    },
    businessPlan: {
      intro: 'Mô tả doanh nghiệp và kế hoạch này để làm gì. Chúng tôi sẽ đánh giá cơ hội thị trường, khả năng phòng thủ, và liệu kế hoạch đã sẵn sàng cho nhà đầu tư chưa, để giúp bạn củng cố trước khi trình bày.',
      inputLabel: 'Ý tưởng kinh doanh của bạn',
      inputPlaceholder: 'Một SaaS quản lý hàng tồn kho theo đăng ký dành cho các nhà bán lẻ độc lập ở Đông Nam Á. Chúng tôi bán cho chủ 10-50 cửa hàng với giá $89/tháng. Lợi thế của chúng tôi là…',
      buttonLabel: 'Xác thực ý tưởng kinh doanh của tôi',
    },
    proposal: {
      intro: 'Mô tả đề xuất — bạn đang đề xuất gì, cho ai, và muốn họ phê duyệt điều gì. Chúng tôi sẽ đánh giá sự rõ ràng, sự phù hợp về giá trị, và khả năng thuyết phục để giúp bạn giành được sự đồng ý.',
      inputLabel: 'Ý tưởng đề xuất của bạn',
      inputPlaceholder: 'Hợp đồng tư vấn 6 tháng để tái cấu trúc hệ thống mua sắm của Acme Corp, trình bày cho Trưởng phòng Vận hành với mức $180K…',
      buttonLabel: 'Xác thực đề xuất của tôi',
    },
    academic: {
      intro: 'Mô tả câu hỏi nghiên cứu và điểm mới của phương pháp. Chúng tôi sẽ đánh giá tính mới, độ phù hợp của phương pháp, và khả năng được chấp nhận trong lĩnh vực để giúp bạn định hình một bài báo có thể bảo vệ được.',
      inputLabel: 'Chủ đề nghiên cứu của bạn',
      inputPlaceholder: 'Một nghiên cứu phương pháp hỗn hợp về cách làm việc từ xa ảnh hưởng đến việc giữ chân kỹ sư đầu sự nghiệp ở các công ty công nghệ tầm trung, sử dụng N=300 khảo sát + 40 phỏng vấn…',
      buttonLabel: 'Xác thực ý tưởng nghiên cứu của tôi',
    },
    legal: {
      intro: 'Mô tả tài liệu pháp lý bạn cần — các bên, giao dịch thương mại, và thẩm quyền. Chúng tôi sẽ đánh giá độ hoàn chỉnh, cân bằng rủi ro, và khả năng thi hành để giúp bạn phát hiện lỗ hổng trước khi soạn thảo.',
      inputLabel: 'Tài liệu của bạn và nội dung cần bao hàm',
      inputPlaceholder: 'Hợp đồng dịch vụ giữa xưởng thiết kế của tôi và khách hàng SaaS Series B cho một hợp đồng 6 tháng với mức $18K/tháng, chịu sự điều chỉnh của luật Úc…',
      buttonLabel: 'Kiểm tra tài liệu pháp lý của tôi',
    },
    technical: {
      intro: 'Mô tả tài liệu kỹ thuật — sản phẩm, đối tượng, và vấn đề mà nó giải quyết cho người đọc. Chúng tôi sẽ đánh giá liệu nó có phù hợp với nhu cầu của lập trình viên và khả năng được tìm thấy.',
      inputLabel: 'Ý tưởng tài liệu kỹ thuật của bạn',
      inputPlaceholder: 'Hướng dẫn bắt đầu dành cho lập trình viên tích hợp cơ sở dữ liệu phân tích của Lunar. Độc giả mục tiêu: kỹ sư backend có kinh nghiệm Postgres…',
      buttonLabel: 'Xác thực tài liệu kỹ thuật của tôi',
    },
    reference: {
      intro: 'Mô tả ý tưởng sách nấu ăn hoặc hướng dẫn của bạn — chủ đề, đối tượng, và điểm nhấn. Chúng tôi sẽ đánh giá mức độ nổi bật trong một thể loại đông đúc và ai sẽ quay lại với nó nhiều lần.',
      inputLabel: 'Ý tưởng của bạn',
      inputPlaceholder: 'Một cuốn sách nấu ăn 50 bữa tối một nồi trong tuần dành cho phụ huynh đi làm, tập trung vào các bữa ăn 30 phút với nguyên liệu có sẵn trong tủ bếp…',
      buttonLabel: 'Xác thực ý tưởng của tôi',
    },
    shortForm: {
      intro: 'Mô tả tác phẩm — chủ đề, hình thức, giọng điệu. Chúng tôi sẽ đánh giá tiềm năng thủ pháp và nơi có thể xuất bản.',
      inputLabel: 'Ý tưởng của bạn',
      inputPlaceholder: 'Một tuyển tập 40 bài thơ tự do về di cư, được kể qua ba thế hệ phụ nữ trong một gia đình…',
      buttonLabel: 'Xác thực ý tưởng của tôi',
    },
  },
};

/**
 * Apply the user's locale to a rubric. Returns a new rubric object whose
 * user-visible fields are localised; expertise + criteria are preserved
 * verbatim so the server-side AI prompt is unaffected.
 *
 * If the locale has no translation (e.g. a locale we haven't added yet, or
 * a rubric whose intro doesn't match any known key), returns the rubric
 * unchanged (English fallback — graceful degradation).
 */
export function applyRubricLocale(
  rubric: ValidationRubric,
  locale: Locale,
): ValidationRubric {
  if (locale === 'en') return rubric;
  const key = identifyRubric(rubric);
  if (!key) return rubric;
  const bundle = TRANSLATIONS[locale as Exclude<Locale, 'en'>];
  if (!bundle) return rubric;
  const translated = bundle[key];
  if (!translated) return rubric;
  return {
    ...rubric,
    intro: translated.intro,
    inputLabel: translated.inputLabel,
    inputPlaceholder: translated.inputPlaceholder,
    buttonLabel: translated.buttonLabel,
  };
}
