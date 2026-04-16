import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

interface ProjectData {
  title: string;
  description: string;
  authorName: string;
  aboutAuthor: string;
  wordCount: number;
  chapterCount: number;
  contentType: string;
}

const PLATFORM_TEMPLATES: Record<string, string> = {
  kdp: `Generate a comprehensive Amazon KDP publishing guide for this book. Include:
- Account setup steps if needed
- Exact fields to fill in the KDP dashboard
- ISBN recommendations
- Pricing strategy for the book's genre
- Keywords and categories to select
- KDP Select enrollment pros/cons
- Pre-order setup if applicable
- Marketing tips specific to Amazon`,

  ingram_spark: `Generate an IngramSpark publishing guide including:
- Account setup and fees
- Print specifications and trim sizes
- Distribution channel selection
- Pricing and discount structures
- Returnability settings
- Library distribution options
- Timeline expectations`,

  bn_press: `Generate a Barnes & Noble Press guide including:
- Account creation steps
- Manuscript formatting requirements
- Cover specifications
- Pricing recommendations
- NOOK Press vs Print options
- Distribution to B&N stores
- Promotional opportunities`,

  apple_books: `Generate an Apple Books publishing guide including:
- iTunes Connect setup
- iBooks Author vs Pages formatting
- Cover requirements
- Pricing in multiple currencies
- Pre-order setup
- Apple Books for Authors features
- Marketing within Apple ecosystem`,

  google_play: `Generate a Google Play Books guide including:
- Google Play Books Partner Center setup
- File format requirements
- Metadata optimization
- Pricing strategies
- Google Books preview settings
- Discovery and search optimization`,

  kobo: `Generate a Kobo Writing Life guide including:
- Account setup process
- Kobo Plus enrollment options
- International pricing
- Promotional tools (Kobo Deals)
- Manuscript requirements
- Cover specifications`,

  smashwords: `Generate a Smashwords guide including:
- Account creation
- Style Guide compliance
- Meatgrinder formatting tips
- Premium Catalog requirements
- Distribution to retailers
- Pricing strategies
- Coupon creation`,

  draft2digital: `Generate a Draft2Digital guide including:
- Account setup
- Universal Book Links
- Print-on-demand options
- Distribution channel selection
- Formatting assistance
- Payment schedules`,

  lulu: `Generate a Lulu publishing guide including:
- Account creation
- Print specifications
- Binding options
- Global distribution
- Pricing calculator usage
- Direct sales vs retail distribution`,

  blurb: `Generate a Blurb publishing guide including:
- BookWright software usage
- Print quality options
- Photo book vs trade book
- Distribution to Amazon
- Pricing and margins
- Sample ordering`,

  gumroad: `Generate a Gumroad guide including:
- Account setup
- Product page optimization
- Pricing psychology
- Audience building
- Email integration
- Discount and bundle strategies`,

  payhip: `Generate a Payhip guide including:
- Store setup
- Payment processing
- EU VAT handling
- Affiliate program setup
- PDF security options
- Email marketing integration`,

  wattpad: `Generate a Wattpad Paid Stories guide including:
- Wattpad Stars program
- Paid Stories eligibility
- Reader engagement strategies
- Chapter scheduling
- Community building
- Coins system explanation`,

  bookbaby: `Generate a BookBaby guide including:
- Service packages comparison
- Editing services
- Cover design options
- Distribution networks
- Marketing packages
- Timeline expectations`,

  publishdrive: `Generate a PublishDrive guide including:
- Account setup
- AI-powered recommendations
- 400+ store distribution
- Royalty reporting
- Promotional tools
- Subscription options`,

  streetlib: `Generate a StreetLib guide including:
- European market focus
- Multi-language support
- Distribution network
- Royalty structures
- Self-publishing tools
- Print-on-demand options`,
};

export async function POST(request: NextRequest) {
  try {
    const { projectId, platformSlug, projectData } = await request.json() as {
      projectId: string;
      platformSlug: string;
      projectData: ProjectData;
    };

    if (!projectId || !platformSlug || !projectData) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const template = PLATFORM_TEMPLATES[platformSlug];
    if (!template) {
      return NextResponse.json(
        { error: 'Unknown platform' },
        { status: 400 }
      );
    }

    const prompt = `You are a publishing expert helping an author publish their book.

BOOK DETAILS:
- Title: ${projectData.title}
- Author: ${projectData.authorName}
- Description: ${projectData.description}
- About the Author: ${projectData.aboutAuthor || 'Not provided'}
- Word Count: ${projectData.wordCount.toLocaleString()}
- Chapter Count: ${projectData.chapterCount}
- Content Type: ${projectData.contentType}

${template}

FORMAT YOUR RESPONSE AS A PRACTICAL, COPY-PASTE READY GUIDE:
1. Start with a summary of what they'll need before starting
2. Provide step-by-step instructions with exact text to enter where applicable
3. Include the book's actual details (title, description, author bio) formatted for that platform
4. Add tips specific to their book type/genre
5. End with a checklist they can use to verify completion

Use markdown formatting. Be specific and actionable. Include the actual book metadata they should copy-paste.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const guide = message.content[0].type === 'text' 
      ? message.content[0].text 
      : '';

    return NextResponse.json({ guide });
  } catch (error) {
    console.error('Error generating guide:', error);
    return NextResponse.json(
      { error: 'Failed to generate guide' },
      { status: 500 }
    );
  }
}
