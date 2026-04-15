import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  FileText,
  Shield,
  Zap,
  Building2,
  GraduationCap,
  Stethoscope,
  Scale,
  Landmark,
  Code,
  BookOpen,
  ArrowRight,
  CheckCircle2,
} from 'lucide-react';

const industries = [
  { icon: Stethoscope, label: 'Healthcare', description: 'HIPAA-compliant medical content' },
  { icon: GraduationCap, label: 'Education', description: 'Curriculum-aligned materials' },
  { icon: Building2, label: 'Finance', description: 'SEC-compliant documentation' },
  { icon: Scale, label: 'Legal', description: 'Contract drafting & research' },
  { icon: Landmark, label: 'Government', description: 'Policy & public communications' },
  { icon: Code, label: 'Technology', description: 'API docs & technical guides' },
  { icon: BookOpen, label: 'Publishing', description: 'Books & creative content' },
];

const features = [
  {
    icon: Shield,
    title: 'Verified & Compliant',
    description: 'Every claim grounded in sources. Anti-hallucination verification built-in.',
  },
  {
    icon: Zap,
    title: 'Industry-Intelligent',
    description: 'AI agents configured for your industry terminology, regulations, and standards.',
  },
  {
    icon: FileText,
    title: 'Publication-Ready',
    description: 'Export to PDF, DOCX, or publish directly to the knowledge marketplace.',
  },
];

const pricing = [
  {
    name: 'Free',
    price: '$0',
    description: 'For individuals getting started',
    features: ['3 projects', '10,000 words/month', 'Basic AI (Haiku)', 'Export to PDF'],
    cta: 'Get Started',
    highlighted: false,
  },
  {
    name: 'Pro',
    price: '$29',
    period: '/month',
    description: 'For serious creators',
    features: ['Unlimited projects', '100,000 words/month', 'Advanced AI (Sonnet)', 'All export formats', 'Citation tracking'],
    cta: 'Start Pro Trial',
    highlighted: true,
  },
  {
    name: 'Team',
    price: '$49',
    period: '/user/month',
    description: 'For organizations',
    features: ['Everything in Pro', 'Organization workspace', 'Collaboration tools', 'Brand customization', 'Priority support'],
    cta: 'Contact Sales',
    highlighted: false,
  },
];

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Navigation */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center space-x-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-lg">P</span>
            </div>
            <span className="font-bold text-xl">Penworth</span>
          </Link>
          <nav className="hidden md:flex items-center space-x-6">
            <Link href="#features" className="text-sm font-medium text-muted-foreground hover:text-foreground">
              Features
            </Link>
            <Link href="#industries" className="text-sm font-medium text-muted-foreground hover:text-foreground">
              Industries
            </Link>
            <Link href="#pricing" className="text-sm font-medium text-muted-foreground hover:text-foreground">
              Pricing
            </Link>
          </nav>
          <div className="flex items-center space-x-4">
            <Link href="/login">
              <Button variant="ghost">Log in</Button>
            </Link>
            <Link href="/signup">
              <Button>Get Started</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="container py-24 md:py-32">
          <div className="mx-auto max-w-4xl text-center">
            <h1 className="mb-6 text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
              Knowledge,{' '}
              <span className="gradient-text">verified.</span>
            </h1>
            <p className="mx-auto mb-10 max-w-2xl text-lg text-muted-foreground md:text-xl">
              Transform your expertise into verified, compliance-ready, publication-quality documents. 
              From scientific papers to business plans, across every industry that demands accuracy.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/signup">
                <Button size="lg" className="h-12 px-8 text-base">
                  Start Creating Free
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="#features">
                <Button size="lg" variant="outline" className="h-12 px-8 text-base">
                  See How It Works
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="container py-24 bg-muted/30">
          <div className="mx-auto max-w-5xl">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">
                Enterprise-grade knowledge creation
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                More rigorous than ChatGPT. More specialized than Notion. Built for organizations that can't afford inaccuracy.
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-8">
              {features.map((feature) => (
                <div key={feature.title} className="rounded-xl border bg-card p-6">
                  <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                    <feature.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="mb-2 font-semibold text-lg">{feature.title}</h3>
                  <p className="text-muted-foreground">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Industries Section */}
        <section id="industries" className="container py-24">
          <div className="mx-auto max-w-5xl">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">
                Built for your industry
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Industry-specific AI agents that understand your terminology, regulations, and standards.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {industries.map((industry) => (
                <div
                  key={industry.label}
                  className="flex flex-col items-center rounded-xl border bg-card p-6 text-center hover:border-primary/50 transition-colors"
                >
                  <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <industry.icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="font-semibold mb-1">{industry.label}</h3>
                  <p className="text-sm text-muted-foreground">{industry.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section id="pricing" className="container py-24 bg-muted/30">
          <div className="mx-auto max-w-5xl">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">
                Simple, transparent pricing
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Start free, scale as you grow. No hidden fees.
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-8">
              {pricing.map((plan) => (
                <div
                  key={plan.name}
                  className={`rounded-xl border bg-card p-6 ${
                    plan.highlighted ? 'border-primary ring-1 ring-primary' : ''
                  }`}
                >
                  {plan.highlighted && (
                    <div className="mb-4 inline-flex items-center rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                      Most Popular
                    </div>
                  )}
                  <h3 className="font-semibold text-lg">{plan.name}</h3>
                  <div className="mt-2 mb-4">
                    <span className="text-3xl font-bold">{plan.price}</span>
                    {plan.period && <span className="text-muted-foreground">{plan.period}</span>}
                  </div>
                  <p className="text-sm text-muted-foreground mb-6">{plan.description}</p>
                  <ul className="space-y-3 mb-6">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center text-sm">
                        <CheckCircle2 className="h-4 w-4 text-green-500 mr-2 flex-shrink-0" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <Link href="/signup">
                    <Button
                      className="w-full"
                      variant={plan.highlighted ? 'default' : 'outline'}
                    >
                      {plan.cta}
                    </Button>
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="container py-24">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">
              Ready to create knowledge that matters?
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              Join organizations that trust Penworth for their most critical documents.
            </p>
            <Link href="/signup">
              <Button size="lg" className="h-12 px-8 text-base">
                Start Creating Free
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t">
        <div className="container py-8 md:py-12">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center space-x-2">
              <div className="h-6 w-6 rounded bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-sm">P</span>
              </div>
              <span className="font-semibold">Penworth</span>
            </div>
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} Penworth. All rights reserved.
            </p>
            <div className="flex items-center space-x-4">
              <Link href="/privacy" className="text-sm text-muted-foreground hover:text-foreground">
                Privacy
              </Link>
              <Link href="/terms" className="text-sm text-muted-foreground hover:text-foreground">
                Terms
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
