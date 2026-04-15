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

const translations = {
  en: {
    nav: { features: 'Features', pricing: 'Pricing', login: 'Log in', getStarted: 'Get Started' },
    hero: {
      badge: 'AI-Powered Book Creation',
      title: 'Write your book.',
      titleHighlight: 'AI does the rest.',
      subtitle: 'From idea to published book in 48 hours. Penworth transforms your expertise into professionally written, publication-ready books with AI.',
      cta: 'Start Writing Free',
      ctaSecondary: 'See How It Works',
      noCard: 'No credit card required',
      freeCredits: '1,000 free credits',
    },
    features: {
      title: 'Everything you need to publish',
      subtitle: 'Professional book creation, powered by AI',
      items: [
        { title: 'AI Interview', description: 'Our AI interviews you about your topic, extracting your unique expertise and perspective.' },
        { title: 'Smart Outline', description: 'Generate a structured book outline that captures your vision and organizes your ideas.' },
        { title: 'Chapter Writing', description: 'AI writes each chapter in your voice, maintaining consistency throughout your book.' },
        { title: 'One-Click Publishing', description: 'Export to PDF, DOCX, or publish directly to Amazon KDP with a single click.' },
      ],
    },
    pricing: {
      title: 'Simple, transparent pricing',
      subtitle: 'Start free. Upgrade when you need more.',
      monthly: 'Monthly',
      annual: 'Annual',
      save: 'Save 17%',
      plans: {
        free: { name: 'Free', price: '$0', description: 'Perfect for trying Penworth', features: ['1,000 credits (1 book)', 'PDF export with branding', 'Amazon KDP publishing', 'Basic AI model'], cta: 'Get Started' },
        pro: { name: 'Pro', price: '$19', priceAnnual: '$190', period: '/month', periodAnnual: '/year', description: 'For serious authors', features: ['2,000 credits (2 books)', 'PDF & DOCX export', 'No branding', 'Advanced AI model', 'Buy extra credit packs'], cta: 'Start Pro', popular: true },
        max: { name: 'Max', price: '$49', priceAnnual: '$490', period: '/month', periodAnnual: '/year', description: 'For power users', features: ['5,000 credits (5 books)', 'All export formats', 'All publishing platforms', 'Premium AI model', 'Credit rollover', 'Priority support'], cta: 'Start Max' },
      },
      creditPacks: { title: 'Need more credits?', subtitle: 'Credit packs for Pro and Max subscribers', packs: [{ credits: '1,000', price: '$39', label: 'Single' }, { credits: '3,000', price: '$99', label: 'Triple' }, { credits: '10,000', price: '$290', label: 'Bulk' }] },
    },
    cta: { title: 'Ready to write your book?', subtitle: 'Join thousands of authors who have published with Penworth.', button: 'Start Writing Free' },
    footer: { copyright: '© 2026 A.C.N. 675 668 710 PTY LTD. All rights reserved.', privacy: 'Privacy', terms: 'Terms' },
  },
  ar: {
    nav: { features: 'المميزات', pricing: 'الأسعار', login: 'تسجيل الدخول', getStarted: 'ابدأ الآن' },
    hero: {
      badge: 'إنشاء الكتب بالذكاء الاصطناعي',
      title: 'اكتب كتابك.',
      titleHighlight: 'الذكاء الاصطناعي يفعل الباقي.',
      subtitle: 'من الفكرة إلى الكتاب المنشور في 48 ساعة. يحول Penworth خبرتك إلى كتب مكتوبة باحتراف وجاهزة للنشر.',
      cta: 'ابدأ الكتابة مجاناً',
      ctaSecondary: 'شاهد كيف يعمل',
      noCard: 'لا حاجة لبطاقة ائتمان',
      freeCredits: '1,000 رصيد مجاني',
    },
    features: {
      title: 'كل ما تحتاجه للنشر',
      subtitle: 'إنشاء كتب احترافية بقوة الذكاء الاصطناعي',
      items: [
        { title: 'مقابلة الذكاء الاصطناعي', description: 'يجري الذكاء الاصطناعي مقابلة معك حول موضوعك.' },
        { title: 'مخطط ذكي', description: 'إنشاء مخطط كتاب منظم يلتقط رؤيتك.' },
        { title: 'كتابة الفصول', description: 'يكتب الذكاء الاصطناعي كل فصل بصوتك.' },
        { title: 'نشر بنقرة واحدة', description: 'تصدير إلى PDF أو النشر على Amazon KDP.' },
      ],
    },
    pricing: {
      title: 'أسعار بسيطة وشفافة',
      subtitle: 'ابدأ مجاناً. قم بالترقية عندما تحتاج.',
      monthly: 'شهري',
      annual: 'سنوي',
      save: 'وفر 17%',
      plans: {
        free: { name: 'مجاني', price: '$0', description: 'مثالي للتجربة', features: ['1,000 رصيد (كتاب واحد)', 'تصدير PDF', 'نشر Amazon KDP', 'نموذج AI أساسي'], cta: 'ابدأ الآن' },
        pro: { name: 'برو', price: '$19', priceAnnual: '$190', period: '/شهر', periodAnnual: '/سنة', description: 'للمؤلفين الجادين', features: ['2,000 رصيد (كتابان)', 'تصدير PDF و DOCX', 'بدون علامة تجارية', 'نموذج AI متقدم'], cta: 'ابدأ برو', popular: true },
        max: { name: 'ماكس', price: '$49', priceAnnual: '$490', period: '/شهر', periodAnnual: '/سنة', description: 'للمحترفين', features: ['5,000 رصيد (5 كتب)', 'جميع الصيغ', 'جميع المنصات', 'دعم ذو أولوية'], cta: 'ابدأ ماكس' },
      },
      creditPacks: { title: 'تحتاج المزيد؟', subtitle: 'حزم رصيد إضافية', packs: [{ credits: '1,000', price: '$39', label: 'فردي' }, { credits: '3,000', price: '$99', label: 'ثلاثي' }, { credits: '10,000', price: '$290', label: 'جماعي' }] },
    },
    cta: { title: 'مستعد لكتابة كتابك؟', subtitle: 'انضم لآلاف المؤلفين.', button: 'ابدأ الكتابة مجاناً' },
    footer: { copyright: '© 2026 A.C.N. 675 668 710 PTY LTD', privacy: 'الخصوصية', terms: 'الشروط' },
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
              <Link href="#pricing" className="text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors">{t.nav.pricing}</Link>
            </nav>

            <div className="flex items-center gap-2">
              {/* Language Selector - All 10 Languages */}
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

        {/* Pricing */}
        <section id="pricing" className="py-24 bg-neutral-50 dark:bg-neutral-900/50">
          <div className="mx-auto max-w-6xl px-6">
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">{t.pricing.title}</h2>
              <p className="text-lg text-neutral-600 dark:text-neutral-400 mb-8">{t.pricing.subtitle}</p>

              <div className="inline-flex items-center gap-1 rounded-full border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-1">
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
                <ul className="space-y-3 mb-8">
                  {t.pricing.plans.free.features.map((f, i) => <li key={i} className="flex items-start gap-3 text-sm"><Check className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" /><span className="text-neutral-600 dark:text-neutral-400">{f}</span></li>)}
                </ul>
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
                  <div key={i} className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-6 py-4 text-center hover:border-amber-500/50 transition-colors">
                    <div className="font-semibold text-lg">{pack.credits}</div>
                    <div className="text-xs text-neutral-500">{pack.label}</div>
                    <div className="text-amber-600 dark:text-amber-400 font-bold mt-1">{pack.price}</div>
                  </div>
                ))}
              </div>
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
              <Link href="/privacy" className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white transition-colors">{t.footer.privacy}</Link>
              <Link href="/terms" className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white transition-colors">{t.footer.terms}</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
