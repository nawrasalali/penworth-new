'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { 
  ArrowRight, 
  BookOpen, 
  Sparkles, 
  Zap, 
  Shield,
  Globe,
  Check,
  Sun,
  Moon,
  ChevronDown,
  MessageSquare,
  FileText,
  Upload,
  Bot,
  Search,
  PenTool,
  ShieldCheck,
  Rocket,
  Library,
  Users,
  CreditCard,
  Headphones,
  Clock,
  Award,
  Brain,
} from 'lucide-react';

// All supported languages with their subdomains (11 total)
const LANGUAGES = [
  { code: 'en', name: 'English', subdomain: 'new', flag: '🇬🇧' },
  { code: 'ar', name: 'العربية', subdomain: 'ar', flag: '🇸🇦', rtl: true },
  { code: 'es', name: 'Español', subdomain: 'es', flag: '🇪🇸' },
  { code: 'fr', name: 'Français', subdomain: 'fr', flag: '🇫🇷' },
  { code: 'pt', name: 'Português', subdomain: 'pt', flag: '🇧🇷' },
  { code: 'ru', name: 'Русский', subdomain: 'ru', flag: '🇷🇺' },
  { code: 'zh', name: '中文', subdomain: 'zh', flag: '🇨🇳' },
  { code: 'vi', name: 'Tiếng Việt', subdomain: 'vi', flag: '🇻🇳' },
  { code: 'bn', name: 'বাংলা', subdomain: 'bn', flag: '🇧🇩' },
  { code: 'id', name: 'Bahasa Indonesia', subdomain: 'id', flag: '🇮🇩' },
  { code: 'hi', name: 'हिन्दी', subdomain: 'hi', flag: '🇮🇳' },
];

// Document types for the new section
const DOCUMENT_TYPES = {
  en: {
    title: 'Create Any Document Type',
    subtitle: 'From books to business plans, Penworth handles them all',
    categories: [
      {
        name: 'Books',
        types: ['Fiction', 'Non-Fiction', 'Memoir', 'Self-Help', 'Biography', 'Children\'s Books', 'Poetry', 'Cookbook', 'Travel Guide'],
      },
      {
        name: 'Academic & Scientific',
        types: ['Research Papers', 'Thesis', 'Dissertations', 'Technical Documentation', 'White Papers'],
      },
      {
        name: 'Business & Finance',
        types: ['Business Plans', 'Financial Reports', 'Proposals', 'Case Studies', 'Market Analysis'],
      },
    ],
  },
  ar: {
    title: 'أنشئ أي نوع من المستندات',
    subtitle: 'من الكتب إلى خطط العمل، Penworth يتعامل معها جميعاً',
    categories: [
      {
        name: 'الكتب',
        types: ['روايات', 'غير خيالي', 'مذكرات', 'تطوير ذاتي', 'سيرة ذاتية', 'كتب أطفال', 'شعر', 'كتب طبخ', 'دليل سفر'],
      },
      {
        name: 'أكاديمي وعلمي',
        types: ['أوراق بحثية', 'رسائل ماجستير', 'رسائل دكتوراه', 'توثيق تقني', 'أوراق بيضاء'],
      },
      {
        name: 'أعمال ومالية',
        types: ['خطط عمل', 'تقارير مالية', 'مقترحات', 'دراسات حالة', 'تحليل سوق'],
      },
    ],
  },
};

// AI Agents data
const AI_AGENTS = {
  en: {
    title: 'Powered by 7 Specialized AI Agents',
    subtitle: 'Each agent is an expert in their domain, powered by Claude — the world\'s most capable AI',
    agents: [
      { name: 'Validator Agent', description: 'Scores your idea against market demand, audience clarity, and commercial viability before you start', icon: ShieldCheck },
      { name: 'Interview Agent', description: 'Conducts an intelligent conversation to extract your expertise, vision, and unique perspective', icon: MessageSquare },
      { name: 'Research Agent', description: 'Gathers credible sources, statistics, and relevant data to strengthen your document', icon: Search },
      { name: 'Outline Agent', description: 'Creates a professional structure with chapters, sections, and logical flow', icon: FileText },
      { name: 'Writing Agent', description: 'Transforms your outline into polished, engaging content in your voice', icon: PenTool },
      { name: 'QA Agent', description: 'Checks grammar, readability, consistency, and plagiarism automatically', icon: Shield },
      { name: 'Publishing Agent', description: 'Formats for KDP, generates covers, and prepares for 17+ publishing platforms', icon: Rocket },
    ],
  },
  ar: {
    title: 'مدعوم بـ 7 وكلاء ذكاء اصطناعي متخصصين',
    subtitle: 'كل وكيل خبير في مجاله، مدعوم بـ Claude - أقوى ذكاء اصطناعي في العالم',
    agents: [
      { name: 'وكيل التحقق', description: 'يقيّم فكرتك بناءً على طلب السوق ووضوح الجمهور والجدوى التجارية', icon: ShieldCheck },
      { name: 'وكيل المقابلة', description: 'يجري محادثة ذكية لاستخراج خبرتك ورؤيتك', icon: MessageSquare },
      { name: 'وكيل البحث', description: 'يجمع مصادر موثوقة وإحصاءات لتقوية مستندك', icon: Search },
      { name: 'وكيل المخطط', description: 'ينشئ هيكلاً احترافياً بالفصول والأقسام', icon: FileText },
      { name: 'وكيل الكتابة', description: 'يحول مخططك إلى محتوى متقن وجذاب', icon: PenTool },
      { name: 'وكيل الجودة', description: 'يتحقق من القواعد والقراءة والاتساق تلقائياً', icon: Shield },
      { name: 'وكيل النشر', description: 'يُهيئ لـ KDP وينشئ الأغلفة ويُعد لـ 17+ منصة', icon: Rocket },
    ],
  },
};

// Benefits data
const BENEFITS = {
  en: {
    title: 'Why Authors Choose Penworth',
    items: [
      { title: 'Lifetime Account', description: 'Your library is saved forever. Access your documents anytime, from any device.', icon: Library },
      { title: 'Publishing Marketplace', description: 'Publish to our marketplace where readers can discover and buy your work.', icon: Users },
      { title: 'One-Click Publishing', description: 'We handle formatting, covers, and distribution. Just click publish.', icon: Zap },
      { title: 'Top Up Anytime', description: 'All tiers can purchase credit packs whenever needed. No restrictions.', icon: CreditCard },
      { title: 'Audiobooks Coming Soon', description: 'AI-powered audiobook generation is in our pipeline. Stay tuned!', icon: Headphones },
      { title: 'Fast Creation', description: 'Go from idea to publication-ready document in hours, not months.', icon: Clock },
    ],
  },
  ar: {
    title: 'لماذا يختار المؤلفون Penworth',
    items: [
      { title: 'حساب مدى الحياة', description: 'مكتبتك محفوظة للأبد. الوصول لمستنداتك في أي وقت.', icon: Library },
      { title: 'سوق النشر', description: 'انشر في سوقنا حيث يمكن للقراء اكتشاف وشراء عملك.', icon: Users },
      { title: 'نشر بنقرة واحدة', description: 'نتولى التنسيق والأغلفة والتوزيع. فقط انقر نشر.', icon: Zap },
      { title: 'شحن رصيد في أي وقت', description: 'جميع المستويات يمكنها شراء حزم رصيد عند الحاجة.', icon: CreditCard },
      { title: 'الكتب الصوتية قريباً', description: 'إنشاء كتب صوتية بالذكاء الاصطناعي في خططنا المستقبلية.', icon: Headphones },
      { title: 'إنشاء سريع', description: 'من الفكرة إلى مستند جاهز للنشر في ساعات، ليس أشهر.', icon: Clock },
    ],
  },
};

const translations = {
  en: {
    nav: { features: 'Features', pricing: 'Pricing', login: 'Log in', getStarted: 'Get Started' },
    hero: {
      badge: 'The literary ecosystem',
      title: 'The book inside you,',
      titleHighlight: 'finished this week.',
      subtitle: "You've carried this story long enough. Tell it out loud, once, and Penworth writes it with you — one chapter at a time, in your voice, in your language. We publish it, produce the audiobook and Cinematic Livebook, design the cover, and put it in front of readers who will want to read it, hear it, and see it come to life.",
      cta: 'Start your book',
      ctaSecondary: 'See how it works',
      noCard: 'No credit card required',
      freeCredits: 'First book free',
    },
    features: {
      title: 'From your story to the world',
      subtitle: 'Every step handled end-to-end — by Penworth',
      items: [
        { title: 'A conversation, not a form', description: "You speak your story. Penworth listens — and captures the part only you could tell." },
        { title: 'The shape of your book', description: 'Chapters, flow, and structure proposed in minutes. You adjust. You own the outline.' },
        { title: 'Written in your voice', description: 'Each chapter drafted in the voice you speak — not a generic house style.' },
        { title: 'Published the same week', description: "Ebook, audiobook, cover, and distribution — ready before the week is out." },
      ],
    },
    pricing: {
      title: 'Simple, transparent pricing',
      subtitle: 'Start free. Upgrade when you need more.',
      monthly: 'Monthly',
      annual: 'Annual',
      save: 'Save 17%',
      allCanTopUp: '✨ All tiers can top up credits anytime',
      plans: {
        free: { 
          name: 'Free', 
          price: '$0', 
          description: 'Perfect for trying Penworth', 
          features: [
            '1 document free (first month only)', 
            'PDF export with small footer watermark', 
            'Amazon KDP publishing', 
            'Basic AI model',
            'Top up credits anytime',
            'Watermark removed when you top up or refer',
          ], 
          cta: 'Get Started',
          note: 'Account stays active forever • Top up anytime to continue',
        },
        pro: { 
          name: 'Pro', 
          price: '$19', 
          priceAnnual: '$190', 
          period: '/month', 
          periodAnnual: '/year', 
          description: 'For serious authors', 
          features: [
            '2,000 credits (2 documents)', 
            'PDF & DOCX export', 
            'No watermark', 
            'Advanced AI model', 
            'Top up credit packs anytime',
          ], 
          cta: 'Start Pro', 
          popular: true 
        },
        max: { 
          name: 'Max', 
          price: '$49', 
          priceAnnual: '$490', 
          period: '/month', 
          periodAnnual: '/year', 
          description: 'For power users', 
          features: [
            '5,000 credits (5 documents)', 
            'All export formats', 
            'All 17 publishing platforms', 
            'Premium AI model', 
            'Credit rollover', 
            'Priority support',
          ], 
          cta: 'Start Max' 
        },
      },
      creditPacks: { 
        title: 'Need more credits?', 
        subtitle: 'Credit packs available for ALL tiers — including Free!', 
        packs: [
          { credits: '1,000', price: '$39', label: 'Single' }, 
          { credits: '3,000', price: '$99', label: 'Triple' }, 
          { credits: '10,000', price: '$290', label: 'Bulk' }
        ] 
      },
    },
    cta: {
      title: "Your story won't tell itself.",
      subtitle: 'Start today. See the first chapter tonight.',
      button: 'Start your book'
    },
    footer: { 
      copyright: '© 2026 A.C.N. 675 668 710 PTY LTD. All rights reserved.', 
      privacy: 'Privacy', 
      terms: 'Terms',
      guild: 'Guild'
    },
  },
  ar: {
    nav: { features: 'المميزات', pricing: 'الأسعار', login: 'تسجيل الدخول', getStarted: 'ابدأ الآن' },
    hero: {
      badge: 'النظام الأدبي المتكامل',
      title: 'الكتاب اللي جواك،',
      titleHighlight: 'خلّصه هالأسبوع.',
      subtitle: 'حكايتك حملتها كفاية. احكيها مرّة بصوتك، وPenworth بيكتبها معك — فصل فصل، بلغتك، بصوتك انت. نحنا بنطبعها، بنعمل الكتاب الصوتي، بنصمم الغلاف، وبنوصلها للقرّاء اللي بدهم يقرؤوها، يسمعوها، ويشوفوها تحيا قدامهم.',
      cta: 'ابدأ كتابك',
      ctaSecondary: 'شوف كيف بيصير',
      noCard: 'بدون بطاقة ائتمان',
      freeCredits: 'أول كتاب ببلاش',
    },
    features: {
      title: 'من قصتك للعالم',
      subtitle: 'كل خطوة من الأول للآخر — Penworth بيعملها',
      items: [
        { title: 'مكالمة، مش استمارة', description: 'انت بتحكي قصتك، وPenworth عم يصغي — وبيلتقط الشي اللي بس انت قادر تقوله.' },
        { title: 'شكل كتابك', description: 'الفصول والترتيب بيجهزوا بدقائق. بتعدّل، والمخطط بيبقى ملكك.' },
        { title: 'مكتوب بصوتك', description: 'كل فصل بيتكتب بصوتك انت — مش بأسلوب عام محفوظ.' },
        { title: 'مطبوع بنفس الأسبوع', description: 'كتاب إلكتروني، صوتي، غلاف، وتوزيع — جاهزين قبل ما يخلص الأسبوع.' },
      ],
    },
    pricing: {
      title: 'أسعار بسيطة وشفافة',
      subtitle: 'ابدأ مجاناً. قم بالترقية عندما تحتاج.',
      monthly: 'شهري',
      annual: 'سنوي',
      save: 'وفر 17%',
      allCanTopUp: '✨ جميع المستويات يمكنها شحن الرصيد في أي وقت',
      plans: {
        free: { 
          name: 'مجاني', 
          price: '$0', 
          description: 'مثالي للتجربة', 
          features: [
            'مستند واحد مجاني (الشهر الأول فقط)', 
            'تصدير PDF مع علامة صغيرة في الأسفل', 
            'نشر Amazon KDP', 
            'نموذج AI أساسي',
            'شحن الرصيد في أي وقت',
            'تُزال العلامة عند الشحن أو الإحالة',
          ], 
          cta: 'ابدأ الآن',
          note: 'الحساب يبقى نشطاً للأبد • شحن الرصيد في أي وقت',
        },
        pro: { 
          name: 'برو', 
          price: '$19', 
          priceAnnual: '$190', 
          period: '/شهر', 
          periodAnnual: '/سنة', 
          description: 'للمؤلفين الجادين', 
          features: [
            '2,000 رصيد (مستندان)', 
            'تصدير PDF و DOCX', 
            'بدون علامة تجارية', 
            'نموذج AI متقدم',
            'شحن حزم رصيد في أي وقت',
          ], 
          cta: 'ابدأ برو', 
          popular: true 
        },
        max: { 
          name: 'ماكس', 
          price: '$49', 
          priceAnnual: '$490', 
          period: '/شهر', 
          periodAnnual: '/سنة', 
          description: 'للمحترفين', 
          features: [
            '5,000 رصيد (5 مستندات)', 
            'جميع الصيغ', 
            'جميع 17 منصة نشر', 
            'نموذج AI متميز',
            'ترحيل الرصيد',
            'دعم ذو أولوية',
          ], 
          cta: 'ابدأ ماكس' 
        },
      },
      creditPacks: { 
        title: 'تحتاج المزيد من الرصيد؟', 
        subtitle: 'حزم الرصيد متاحة لجميع المستويات — بما فيها المجاني!', 
        packs: [
          { credits: '1,000', price: '$39', label: 'فردي' }, 
          { credits: '3,000', price: '$99', label: 'ثلاثي' }, 
          { credits: '10,000', price: '$290', label: 'جماعي' }
        ] 
      },
    },
    cta: {
      title: 'قصتك مش رح تحكي حالها.',
      subtitle: 'ابدأ اليوم. بتشوف أول فصل الليلة.',
      button: 'ابدأ كتابك'
    },
    footer: { 
      copyright: '© 2026 A.C.N. 675 668 710 PTY LTD', 
      privacy: 'الخصوصية', 
      terms: 'الشروط',
      guild: 'النقابة'
    },
  },
};

type LangCode = 'en' | 'ar';

export default function HomePage() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();
  const [lang, setLang] = useState<LangCode>('en');
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('annual');
  
  const t = translations[lang];
  const docTypes = DOCUMENT_TYPES[lang];
  const agents = AI_AGENTS[lang];
  const benefits = BENEFITS[lang];
  const isRTL = lang === 'ar';
  const currentLang = LANGUAGES.find(l => l.code === lang) || LANGUAGES[0];

  // Handle language change - redirect to subdomain for other languages
  const handleLanguageChange = (langCode: string) => {
    if (langCode === 'en') {
      setLang('en');
      setLangMenuOpen(false);
    } else if (langCode === 'ar') {
      setLang('ar');
      setLangMenuOpen(false);
    } else {
      // Redirect to the appropriate subdomain
      const targetLang = LANGUAGES.find(l => l.code === langCode);
      if (targetLang) {
        window.location.href = `https://${targetLang.subdomain}.penworth.ai`;
      }
    }
  };

  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return <div className="min-h-screen bg-white dark:bg-neutral-950" />;

  return (
    <div className={`min-h-screen bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 ${isRTL ? 'rtl' : 'ltr'}`} dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Navigation */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-950/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex h-16 items-center justify-between">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/20">
                <BookOpen className="h-5 w-5 text-white" />
              </div>
              <span className="text-xl font-semibold tracking-tight">Penworth</span>
            </Link>

            <nav className="hidden md:flex items-center gap-8">
              <Link href="#features" className="text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors">{t.nav.features}</Link>
              <Link href="#agents" className="text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors">AI Agents</Link>
              <Link href="#pricing" className="text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors">{t.nav.pricing}</Link>
            </nav>

            <div className="flex items-center gap-2">
              {/* Language Selector */}
              <div className="relative">
                <button onClick={() => setLangMenuOpen(!langMenuOpen)} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors">
                  <Globe className="h-4 w-4" />
                  <span className="hidden sm:inline">{currentLang.flag} {currentLang.code.toUpperCase()}</span>
                  <ChevronDown className="h-3 w-3" />
                </button>
                {langMenuOpen && (
                  <div className="absolute top-full mt-2 right-0 w-44 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-1.5 shadow-xl max-h-[400px] overflow-y-auto">
                    {LANGUAGES.map((language) => (
                      <button
                        key={language.code}
                        onClick={() => handleLanguageChange(language.code)}
                        className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors ${lang === language.code ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400' : ''}`}
                      >
                        <span>{language.flag}</span>
                        <span>{language.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Theme */}
              <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="rounded-lg p-2.5 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors">
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>

              <div className="hidden sm:flex items-center gap-2 ml-2">
                <Link href="/login" className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors">{t.nav.login}</Link>
                <Link href="/signup" className="rounded-xl bg-neutral-900 dark:bg-white px-4 py-2 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-100 transition-colors">{t.nav.getStarted}</Link>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative pt-32 pb-24 overflow-hidden">
          <div className="absolute inset-0 -z-10">
            <div className="absolute top-20 left-1/4 w-[500px] h-[500px] bg-amber-500/5 dark:bg-amber-500/10 rounded-full blur-3xl" />
            <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-orange-500/5 dark:bg-orange-500/10 rounded-full blur-3xl" />
          </div>

          <div className="mx-auto max-w-4xl px-6 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-4 py-2 mb-8">
              <Sparkles className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-medium text-neutral-600 dark:text-neutral-400">{t.hero.badge}</span>
            </div>

            <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight mb-6 text-neutral-900 dark:text-white">
              {t.hero.title}<br />
              <span className="bg-gradient-to-r from-amber-500 to-orange-600 bg-clip-text text-transparent">{t.hero.titleHighlight}</span>
            </h1>

            <p className="text-lg sm:text-xl text-neutral-600 dark:text-neutral-400 max-w-2xl mx-auto mb-10 leading-relaxed">{t.hero.subtitle}</p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-10">
              <Link href="/signup" className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-600 px-8 py-4 text-base font-semibold text-white shadow-xl shadow-amber-500/25 hover:shadow-2xl hover:shadow-amber-500/30 hover:-translate-y-0.5 transition-all">
                {t.hero.cta}<ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="#features" className="inline-flex items-center gap-2 rounded-2xl border border-neutral-300 dark:border-neutral-700 px-8 py-4 text-base font-medium hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors">
                {t.hero.ctaSecondary}
              </Link>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-neutral-500 dark:text-neutral-500">
              <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-500" /><span>{t.hero.noCard}</span></div>
              <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-500" /><span>{t.hero.freeCredits}</span></div>
            </div>
          </div>
        </section>

        {/* Document Types Section */}
        <section className="py-24 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50">
          <div className="mx-auto max-w-6xl px-6">
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">{docTypes.title}</h2>
              <p className="text-lg text-neutral-600 dark:text-neutral-400">{docTypes.subtitle}</p>
            </div>

            <div className="grid md:grid-cols-3 gap-8">
              {docTypes.categories.map((category, i) => (
                <div key={i} className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6">
                  <h3 className="font-semibold text-lg mb-4 text-amber-600 dark:text-amber-400">{category.name}</h3>
                  <div className="flex flex-wrap gap-2">
                    {category.types.map((type, j) => (
                      <span key={j} className="inline-block rounded-full bg-neutral-100 dark:bg-neutral-800 px-3 py-1 text-sm text-neutral-600 dark:text-neutral-400">
                        {type}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="py-24 border-t border-neutral-200 dark:border-neutral-800">
          <div className="mx-auto max-w-6xl px-6">
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">{t.features.title}</h2>
              <p className="text-lg text-neutral-600 dark:text-neutral-400">{t.features.subtitle}</p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {t.features.items.map((feature, i) => {
                const icons = [MessageSquare, FileText, Zap, Upload];
                const Icon = icons[i];
                return (
                  <div key={i} className="group rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 hover:border-amber-500/50 hover:shadow-xl hover:shadow-amber-500/5 transition-all">
                    <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/10 to-orange-500/10 dark:from-amber-500/20 dark:to-orange-500/20">
                      <Icon className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                    </div>
                    <h3 className="font-semibold mb-2">{feature.title}</h3>
                    <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">{feature.description}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* AI Agents Section */}
        <section id="agents" className="py-24 border-t border-neutral-200 dark:border-neutral-800 bg-gradient-to-b from-neutral-50 to-white dark:from-neutral-900/50 dark:to-neutral-950">
          <div className="mx-auto max-w-6xl px-6">
            <div className="text-center mb-16">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-2 mb-6">
                <Brain className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <span className="text-sm font-medium text-amber-600 dark:text-amber-400">Powered by Claude</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">{agents.title}</h2>
              <p className="text-lg text-neutral-600 dark:text-neutral-400 max-w-2xl mx-auto">{agents.subtitle}</p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {agents.agents.map((agent, i) => {
                const Icon = agent.icon;
                return (
                  <div key={i} className="relative group rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 hover:border-amber-500/50 hover:shadow-xl hover:shadow-amber-500/5 transition-all">
                    <div className="absolute top-4 right-4 text-xs font-medium text-neutral-400 dark:text-neutral-600">
                      {i + 1}/7
                    </div>
                    <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/20">
                      <Icon className="h-6 w-6 text-white" />
                    </div>
                    <h3 className="font-semibold mb-2">{agent.name}</h3>
                    <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">{agent.description}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Benefits Section */}
        <section className="py-24 border-t border-neutral-200 dark:border-neutral-800">
          <div className="mx-auto max-w-6xl px-6">
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">{benefits.title}</h2>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {benefits.items.map((benefit, i) => {
                const Icon = benefit.icon;
                return (
                  <div key={i} className="flex gap-4 p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
                    <div className="flex-shrink-0 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/10 to-orange-500/10 dark:from-amber-500/20 dark:to-orange-500/20">
                      <Icon className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold mb-1">{benefit.title}</h3>
                      <p className="text-sm text-neutral-600 dark:text-neutral-400">{benefit.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="py-24 bg-neutral-50 dark:bg-neutral-900/50">
          <div className="mx-auto max-w-6xl px-6">
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">{t.pricing.title}</h2>
              <p className="text-lg text-neutral-600 dark:text-neutral-400 mb-4">{t.pricing.subtitle}</p>
              <p className="text-sm font-medium text-amber-600 dark:text-amber-400">{t.pricing.allCanTopUp}</p>

              <div className="inline-flex items-center gap-1 rounded-full border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-1 mt-8">
                <button onClick={() => setBillingPeriod('monthly')} className={`rounded-full px-5 py-2.5 text-sm font-medium transition-all ${billingPeriod === 'monthly' ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 shadow-sm' : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'}`}>{t.pricing.monthly}</button>
                <button onClick={() => setBillingPeriod('annual')} className={`rounded-full px-5 py-2.5 text-sm font-medium transition-all flex items-center gap-2 ${billingPeriod === 'annual' ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 shadow-sm' : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'}`}>
                  {t.pricing.annual}
                  <span className="rounded-full bg-emerald-500/10 dark:bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">{t.pricing.save}</span>
                </button>
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
              {/* Free */}
              <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-8">
                <h3 className="font-semibold text-lg mb-1">{t.pricing.plans.free.name}</h3>
                <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">{t.pricing.plans.free.description}</p>
                <div className="mb-6"><span className="text-4xl font-bold">{t.pricing.plans.free.price}</span></div>
                <ul className="space-y-3 mb-4">
                  {t.pricing.plans.free.features.map((f, i) => <li key={i} className="flex items-start gap-3 text-sm"><Check className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" /><span className="text-neutral-600 dark:text-neutral-400">{f}</span></li>)}
                </ul>
                <p className="text-xs text-amber-600 dark:text-amber-400 mb-4">{t.pricing.plans.free.note}</p>
                <Link href="/signup" className="block w-full rounded-xl border border-neutral-300 dark:border-neutral-700 py-3 text-center font-medium hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors">{t.pricing.plans.free.cta}</Link>
              </div>

              {/* Pro */}
              <div className="relative rounded-2xl border-2 border-amber-500 bg-white dark:bg-neutral-900 p-8 shadow-xl shadow-amber-500/10">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2"><span className="rounded-full bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-1 text-xs font-semibold text-white shadow-lg">Most Popular</span></div>
                <h3 className="font-semibold text-lg mb-1">{t.pricing.plans.pro.name}</h3>
                <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">{t.pricing.plans.pro.description}</p>
                <div className="mb-6">
                  <span className="text-4xl font-bold">{billingPeriod === 'annual' ? t.pricing.plans.pro.priceAnnual : t.pricing.plans.pro.price}</span>
                  <span className="text-neutral-500">{billingPeriod === 'annual' ? t.pricing.plans.pro.periodAnnual : t.pricing.plans.pro.period}</span>
                </div>
                <ul className="space-y-3 mb-8">
                  {t.pricing.plans.pro.features.map((f, i) => <li key={i} className="flex items-start gap-3 text-sm"><Check className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" /><span className="text-neutral-600 dark:text-neutral-400">{f}</span></li>)}
                </ul>
                <Link href="/signup?plan=pro" className="block w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 py-3 text-center font-semibold text-white hover:shadow-lg hover:shadow-amber-500/25 transition-all">{t.pricing.plans.pro.cta}</Link>
              </div>

              {/* Max */}
              <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-8">
                <h3 className="font-semibold text-lg mb-1">{t.pricing.plans.max.name}</h3>
                <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">{t.pricing.plans.max.description}</p>
                <div className="mb-6">
                  <span className="text-4xl font-bold">{billingPeriod === 'annual' ? t.pricing.plans.max.priceAnnual : t.pricing.plans.max.price}</span>
                  <span className="text-neutral-500">{billingPeriod === 'annual' ? t.pricing.plans.max.periodAnnual : t.pricing.plans.max.period}</span>
                </div>
                <ul className="space-y-3 mb-8">
                  {t.pricing.plans.max.features.map((f, i) => <li key={i} className="flex items-start gap-3 text-sm"><Check className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" /><span className="text-neutral-600 dark:text-neutral-400">{f}</span></li>)}
                </ul>
                <Link href="/signup?plan=max" className="block w-full rounded-xl border border-neutral-300 dark:border-neutral-700 py-3 text-center font-medium hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors">{t.pricing.plans.max.cta}</Link>
              </div>
            </div>

            {/* Credit Packs */}
            <div className="mt-16 text-center">
              <h3 className="font-semibold mb-2">{t.pricing.creditPacks.title}</h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-6">{t.pricing.creditPacks.subtitle}</p>
              <div className="flex flex-wrap items-center justify-center gap-4">
                {t.pricing.creditPacks.packs.map((pack, i) => (
                  <Link key={i} href="/billing" className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-6 py-4 text-center hover:border-amber-500/50 transition-colors">
                    <div className="font-semibold text-lg">{pack.credits}</div>
                    <div className="text-xs text-neutral-500">{pack.label}</div>
                    <div className="text-amber-600 dark:text-amber-400 font-bold mt-1">{pack.price}</div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Cinematic Livebook — patent-pending category */}
        <section className="py-24 border-t border-neutral-200 dark:border-neutral-800 bg-gradient-to-b from-neutral-50 to-white dark:from-neutral-950 dark:to-neutral-900">
          <div className="mx-auto max-w-4xl px-6 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 px-3 py-1 mb-6">
              <span className="text-xs font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400">Patent-pending · Australia</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-6">
              Introducing the <span className="italic">Cinematic Livebook</span>.
            </h2>
            <p className="text-lg text-neutral-700 dark:text-neutral-300 mb-4 leading-relaxed">
              Each page becomes a live performance — particle simulation, live graphs, or scene imagery that tells the page&apos;s story as you read it.
            </p>
            <p className="text-base text-neutral-500 dark:text-neutral-400 max-w-2xl mx-auto leading-relaxed">
              Audible narrates. Kindle presents text. Netflix watches for you. Penworth directs. Your book, performed on the page.
            </p>
          </div>
        </section>

        {/* Ecosystem cross-link — soft footer, three doors one house */}
        <section className="py-20 border-t border-neutral-200 dark:border-neutral-800">
          <div className="mx-auto max-w-5xl px-6">
            <p className="text-center text-sm uppercase tracking-widest text-neutral-500 dark:text-neutral-500 mb-10">
              One ecosystem. Three doors.
            </p>
            <div className="grid md:grid-cols-2 gap-6">
              <a href="https://store.penworth.ai" className="group rounded-2xl border border-neutral-200 dark:border-neutral-800 p-6 hover:border-amber-300 dark:hover:border-amber-700 transition-colors">
                <p className="text-xs font-medium uppercase tracking-widest text-amber-600 dark:text-amber-400 mb-2">Want to read instead?</p>
                <p className="text-lg font-semibold text-neutral-900 dark:text-white mb-1">Meet the authors &rarr;</p>
                <p className="text-sm text-neutral-500">store.penworth.ai</p>
              </a>
              <a href="https://guild.penworth.ai" className="group rounded-2xl border border-neutral-200 dark:border-neutral-800 p-6 hover:border-amber-300 dark:hover:border-amber-700 transition-colors">
                <p className="text-xs font-medium uppercase tracking-widest text-amber-600 dark:text-amber-400 mb-2">Love connecting people with books?</p>
                <p className="text-lg font-semibold text-neutral-900 dark:text-white mb-1">Earn in the Guild &rarr;</p>
                <p className="text-sm text-neutral-500">guild.penworth.ai</p>
              </a>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-24">
          <div className="mx-auto max-w-3xl px-6 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">{t.cta.title}</h2>
            <p className="text-lg text-neutral-600 dark:text-neutral-400 mb-8">{t.cta.subtitle}</p>
            <Link href="/signup" className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-600 px-8 py-4 text-base font-semibold text-white shadow-xl shadow-amber-500/25 hover:shadow-2xl hover:shadow-amber-500/30 hover:-translate-y-0.5 transition-all">
              {t.cta.button}<ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-neutral-200 dark:border-neutral-800 py-8">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-600">
                <BookOpen className="h-4 w-4 text-white" />
              </div>
              <span className="font-semibold">Penworth</span>
            </div>
            <p className="text-sm text-neutral-500">{t.footer.copyright}</p>
            <div className="flex items-center gap-4">
              <a href="https://guild.penworth.ai" rel="noopener noreferrer" className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white transition-colors">{t.footer.guild}</a>
              <Link href="/legal/privacy" className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white transition-colors">{t.footer.privacy}</Link>
              <Link href="/legal/terms" className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white transition-colors">{t.footer.terms}</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
