'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { 
  BookOpen, 
  HelpCircle, 
  MessageSquare, 
  FileText, 
  Sparkles, 
  CreditCard,
  Users,
  Download,
  ChevronDown,
  ChevronUp,
  Mail,
  ExternalLink
} from 'lucide-react';

const faqs = [
  {
    category: 'Getting Started',
    icon: BookOpen,
    questions: [
      {
        q: 'How do I start writing my first book?',
        a: 'Click "New Project" from your dashboard, choose your book type (fiction, non-fiction, etc.), and our AI will guide you through an interview to understand your vision. Then it will generate an outline and help you write chapter by chapter.'
      },
      {
        q: 'What types of books can I write?',
        a: 'Penworth supports fiction (novels, short stories), non-fiction (memoirs, business books, self-help), educational content, and more. Our AI adapts its writing style to match your genre.'
      },
      {
        q: 'How long does it take to write a book?',
        a: 'Most users complete their first draft in 48-72 hours! The AI does the heavy lifting while you guide the creative direction.'
      }
    ]
  },
  {
    category: 'AI Writing',
    icon: Sparkles,
    questions: [
      {
        q: 'How does the AI understand my writing style?',
        a: 'During the initial interview, the AI learns your preferences, voice, and goals. You can also provide writing samples or adjust the style at any time.'
      },
      {
        q: 'Can I edit what the AI writes?',
        a: 'Absolutely! Every word is editable. The AI provides a foundation that you can refine, expand, or completely rewrite to match your vision.'
      },
      {
        q: 'Is my content original?',
        a: 'Yes. The AI generates unique content based on your inputs. Your book is yours - we never share or reuse your content.'
      }
    ]
  },
  {
    category: 'Credits & Billing',
    icon: CreditCard,
    questions: [
      {
        q: 'How do credits work?',
        a: 'Credits are used for AI generation. Free users get a welcome bonus. You earn more credits through referrals (500 credits per friend who completes their first book) or by upgrading to a paid plan.'
      },
      {
        q: 'What\'s included in the Pro plan?',
        a: 'Pro includes unlimited AI generations, watermark-free exports, priority support, and access to advanced features like multiple book projects and collaboration tools.'
      },
      {
        q: 'Can I cancel my subscription?',
        a: 'Yes, you can cancel anytime from your Billing settings. You\'ll retain access until the end of your billing period.'
      }
    ]
  },
  {
    category: 'Publishing & Export',
    icon: Download,
    questions: [
      {
        q: 'How do I export my book?',
        a: 'Click "Export" in your project to download as PDF or DOCX. Free users get exports with "Written with Penworth" branding; Pro users get clean exports.'
      },
      {
        q: 'Can I publish on Amazon KDP?',
        a: 'Yes! Export your book as a properly formatted file and upload directly to Amazon KDP, IngramSpark, or any other publishing platform.'
      },
      {
        q: 'Do you help with book covers?',
        a: 'Cover design tools are coming soon! For now, we recommend Canva or hiring a designer for your cover.'
      }
    ]
  },
  {
    category: 'Teams & Collaboration',
    icon: Users,
    questions: [
      {
        q: 'Can I invite collaborators?',
        a: 'Yes! You can invite co-authors to review and edit your manuscript. They\'ll receive an email invitation to join your project.'
      },
      {
        q: 'What\'s the difference between reviewer and editor roles?',
        a: 'Reviewers can read and comment on your manuscript. Editors can also make direct changes to the text.'
      },
      {
        q: 'How does the Team plan work?',
        a: 'Team plans allow multiple users under one subscription with shared billing, organization management, and collaborative features.'
      }
    ]
  }
];

export default function HelpPage() {
  const [expandedFaq, setExpandedFaq] = useState<string | null>(null);
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    
    // In production, this would send to your support system
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    setSubmitted(true);
    setSubmitting(false);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Help & Support</h1>
        <p className="text-gray-500 mt-1">
          Find answers to common questions or contact our support team
        </p>
      </div>

      {/* Quick Links */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="hover:shadow-md transition-shadow cursor-pointer">
          <CardContent className="pt-6">
            <a href="https://docs.penworth.ai" target="_blank" rel="noopener" className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-primary/10">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">Documentation</h3>
                <p className="text-sm text-gray-500">Detailed guides & tutorials</p>
              </div>
              <ExternalLink className="h-4 w-4 ml-auto text-gray-400" />
            </a>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow cursor-pointer">
          <CardContent className="pt-6">
            <a href="https://community.penworth.ai" target="_blank" rel="noopener" className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-blue-100">
                <MessageSquare className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold">Community</h3>
                <p className="text-sm text-gray-500">Connect with other authors</p>
              </div>
              <ExternalLink className="h-4 w-4 ml-auto text-gray-400" />
            </a>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow cursor-pointer">
          <CardContent className="pt-6">
            <a href="mailto:support@penworth.ai" className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-green-100">
                <Mail className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <h3 className="font-semibold">Email Support</h3>
                <p className="text-sm text-gray-500">support@penworth.ai</p>
              </div>
              <ExternalLink className="h-4 w-4 ml-auto text-gray-400" />
            </a>
          </CardContent>
        </Card>
      </div>

      {/* FAQs */}
      <div className="space-y-6">
        <h2 className="text-2xl font-bold">Frequently Asked Questions</h2>
        
        {faqs.map((category) => (
          <Card key={category.category}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <category.icon className="h-5 w-5 text-primary" />
                {category.category}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {category.questions.map((faq, idx) => {
                const key = `${category.category}-${idx}`;
                const isExpanded = expandedFaq === key;
                
                return (
                  <div key={key} className="border rounded-lg">
                    <button
                      onClick={() => setExpandedFaq(isExpanded ? null : key)}
                      className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50"
                    >
                      <span className="font-medium">{faq.q}</span>
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-gray-400" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-gray-400" />
                      )}
                    </button>
                    {isExpanded && (
                      <div className="px-4 pb-4 text-gray-600">
                        {faq.a}
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Contact Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-primary" />
            Still Need Help?
          </CardTitle>
          <CardDescription>
            Send us a message and we'll get back to you within 24 hours
          </CardDescription>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <div className="text-center py-8">
              <div className="mx-auto w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-4">
                <MessageSquare className="h-6 w-6 text-green-600" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Message Sent!</h3>
              <p className="text-gray-500">
                We'll get back to you at {contactEmail} within 24 hours.
              </p>
              <Button 
                variant="outline" 
                className="mt-4"
                onClick={() => {
                  setSubmitted(false);
                  setContactName('');
                  setContactEmail('');
                  setContactMessage('');
                }}
              >
                Send Another Message
              </Button>
            </div>
          ) : (
            <form onSubmit={handleContactSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm font-medium">Name</label>
                  <Input
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="Your name"
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Email</label>
                  <Input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="your@email.com"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Message</label>
                <Textarea
                  value={contactMessage}
                  onChange={(e) => setContactMessage(e.target.value)}
                  placeholder="How can we help you?"
                  rows={4}
                  required
                />
              </div>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Sending...' : 'Send Message'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
