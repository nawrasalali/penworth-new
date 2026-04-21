// Email templates for Penworth platform
// Uses Resend for transactional emails

export const emailTemplates = {
  // Welcome email for new users
  welcome: (userName: string, referralCode: string) => ({
    subject: 'Welcome to Penworth - Let\'s Write Your Book!',
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Penworth</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 40px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: bold;">Welcome to Penworth!</h1>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #374151;">
                Hi ${userName || 'there'},
              </p>
              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #374151;">
                You've just joined thousands of authors using AI to write and publish their books in record time. We're excited to have you!
              </p>
              <p style="margin: 0 0 30px; font-size: 16px; line-height: 1.6; color: #374151;">
                Here's what you can do with Penworth:
              </p>
              <ul style="margin: 0 0 30px; padding-left: 20px; color: #374151;">
                <li style="margin-bottom: 10px;">Write your book with AI assistance in 48 hours</li>
                <li style="margin-bottom: 10px;">Export to PDF, DOCX, or ePub format</li>
                <li style="margin-bottom: 10px;">Publish directly to Amazon KDP and 15+ platforms</li>
                <li style="margin-bottom: 10px;">Sell your book on our marketplace</li>
              </ul>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="https://penworth.ai/projects/new" style="display: inline-block; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                      Start Your First Book
                    </a>
                  </td>
                </tr>
              </table>
              <!-- Referral Section -->
              <div style="background-color: #f0fdf4; border-radius: 8px; padding: 20px; margin-top: 30px;">
                <p style="margin: 0 0 10px; font-size: 14px; font-weight: 600; color: #166534;">
                  🎁 Share & Earn Credits
                </p>
                <p style="margin: 0 0 15px; font-size: 14px; color: #166534;">
                  Your referral code: <strong>${referralCode}</strong>
                </p>
                <p style="margin: 0; font-size: 14px; color: #166534;">
                  Invite friends and earn 500 credits when they complete their first book!
                </p>
              </div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 10px; font-size: 14px; color: #6b7280;">
                Questions? Reply to this email or visit our <a href="https://penworth.ai/help" style="color: #6366f1;">Help Center</a>
              </p>
              <p style="margin: 0; font-size: 12px; color: #9ca3af;">
                © 2026 Penworth.ai | A.C.N. 675 668 710 PTY LTD
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `,
  }),

  // Referral notification
  referralSignup: (referrerName: string, refereeName: string) => ({
    subject: 'Someone joined Penworth using your referral!',
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden;">
          <tr>
            <td style="padding: 40px; text-align: center;">
              <div style="font-size: 48px; margin-bottom: 20px;">🎉</div>
              <h1 style="margin: 0 0 20px; color: #111827; font-size: 24px;">Great News, ${referrerName}!</h1>
              <p style="margin: 0 0 20px; font-size: 16px; color: #374151;">
                <strong>${refereeName}</strong> just joined Penworth using your referral link!
              </p>
              <div style="background-color: #fef3c7; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <p style="margin: 0; font-size: 14px; color: #92400e;">
                  You'll earn <strong>500 credits</strong> when they complete their first book.
                </p>
              </div>
              <a href="https://penworth.ai/referrals" style="display: inline-block; background-color: #6366f1; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600;">
                View Your Referrals
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `,
  }),

  // Referral credits earned
  creditsEarned: (userName: string, credits: number, refereeName: string) => ({
    subject: `🎁 You earned ${credits} credits!`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden;">
          <tr>
            <td style="padding: 40px; text-align: center;">
              <div style="font-size: 48px; margin-bottom: 20px;">🎁</div>
              <h1 style="margin: 0 0 20px; color: #111827; font-size: 24px;">${credits} Credits Added!</h1>
              <p style="margin: 0 0 20px; font-size: 16px; color: #374151;">
                Hi ${userName}, your friend <strong>${refereeName}</strong> just completed their first book!
              </p>
              <div style="background-color: #f0fdf4; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <p style="margin: 0; font-size: 24px; font-weight: bold; color: #166534;">
                  +${credits} Credits
                </p>
              </div>
              <p style="margin: 0; font-size: 14px; color: #6b7280;">
                Use your credits to write more books or unlock premium features.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `,
  }),

  // Collaboration invite
  collaborationInvite: (inviterName: string, bookTitle: string, role: string, inviteUrl: string) => ({
    subject: `${inviterName} invited you to collaborate on "${bookTitle}"`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden;">
          <tr>
            <td style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 22px;">You're Invited to Collaborate!</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; font-size: 16px; color: #374151;">
                <strong>${inviterName}</strong> has invited you to collaborate on their book:
              </p>
              <div style="background-color: #f9fafb; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <p style="margin: 0 0 10px; font-size: 18px; font-weight: bold; color: #111827;">"${bookTitle}"</p>
                <p style="margin: 0; font-size: 14px; color: #6b7280;">Role: ${role === 'editor' ? 'Editor (can edit)' : 'Reviewer (can comment)'}</p>
              </div>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="${inviteUrl}" style="display: inline-block; background-color: #6366f1; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600;">
                      Accept Invitation
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0; font-size: 14px; color: #6b7280; text-align: center;">
                This invitation expires in 7 days.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `,
  }),

  // Book completed
  bookCompleted: (userName: string, bookTitle: string) => ({
    subject: `🎉 Your book "${bookTitle}" is complete!`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden;">
          <tr>
            <td style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px; text-align: center;">
              <div style="font-size: 48px; margin-bottom: 10px;">📚</div>
              <h1 style="margin: 0; color: #ffffff; font-size: 24px;">Congratulations, ${userName}!</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; font-size: 16px; color: #374151; text-align: center;">
                Your book <strong>"${bookTitle}"</strong> is now complete!
              </p>
              <p style="margin: 0 0 30px; font-size: 16px; color: #374151; text-align: center;">
                Here's what you can do next:
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 20px;">
                <tr>
                  <td style="padding: 15px; background-color: #f9fafb; border-radius: 8px; margin-bottom: 10px;">
                    <strong>📥 Export</strong> - Download as PDF, DOCX, or ePub
                  </td>
                </tr>
                <tr><td style="height: 10px;"></td></tr>
                <tr>
                  <td style="padding: 15px; background-color: #f9fafb; border-radius: 8px;">
                    <strong>🛒 Sell</strong> - List on the Penworth Marketplace
                  </td>
                </tr>
                <tr><td style="height: 10px;"></td></tr>
                <tr>
                  <td style="padding: 15px; background-color: #f9fafb; border-radius: 8px;">
                    <strong>📤 Publish</strong> - Send to Amazon KDP & 15+ platforms
                  </td>
                </tr>
                <tr><td style="height: 10px;"></td></tr>
                <tr>
                  <td style="padding: 15px; background-color: #f9fafb; border-radius: 8px;">
                    <strong>🔗 Share</strong> - Get a shareable link for your readers
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="https://penworth.ai/projects" style="display: inline-block; background-color: #6366f1; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600;">
                      View Your Book
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `,
  }),

  // Organization invite
  organizationInvite: (inviterName: string, orgName: string, role: string, inviteUrl: string) => ({
    subject: `${inviterName} invited you to join ${orgName} on Penworth`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden;">
          <tr>
            <td style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 22px;">Join ${orgName}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; font-size: 16px; color: #374151;">
                <strong>${inviterName}</strong> has invited you to join their organization <strong>${orgName}</strong> on Penworth.
              </p>
              <div style="background-color: #f9fafb; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <p style="margin: 0; font-size: 14px; color: #6b7280;">Role: <strong>${role}</strong></p>
              </div>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="${inviteUrl}" style="display: inline-block; background-color: #6366f1; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600;">
                      Accept Invitation
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `,
  }),

  // Marketplace purchase notification (to seller)
  marketplaceSale: (sellerName: string, bookTitle: string, buyerName: string, amount: number) => ({
    subject: `💰 Someone purchased "${bookTitle}"!`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden;">
          <tr>
            <td style="padding: 40px; text-align: center;">
              <div style="font-size: 48px; margin-bottom: 20px;">💰</div>
              <h1 style="margin: 0 0 20px; color: #111827; font-size: 24px;">You Made a Sale!</h1>
              <p style="margin: 0 0 20px; font-size: 16px; color: #374151;">
                Hi ${sellerName}, <strong>${buyerName}</strong> just purchased your book:
              </p>
              <div style="background-color: #f0fdf4; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <p style="margin: 0 0 10px; font-size: 18px; font-weight: bold; color: #111827;">"${bookTitle}"</p>
                <p style="margin: 0; font-size: 24px; font-weight: bold; color: #166534;">$${amount.toFixed(2)}</p>
              </div>
              <p style="margin: 0; font-size: 14px; color: #6b7280;">
                Your earnings will be paid out at the end of the month.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `,
  }),
};

export default emailTemplates;
