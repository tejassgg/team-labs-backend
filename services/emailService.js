const nodemailer = require('nodemailer');
require('dotenv').config();

// Create transporter for sending emails
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  secure: false,
  port: 587,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  },
});

// ===== COMMON UTILITY FUNCTIONS =====

  // Helper: get time ago string
  const getTimeAgo = (date) => {
    if (!date) return '';
    const now = new Date();
    const then = new Date(date);
    const diff = Math.floor((now - then) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
    return `${Math.floor(diff/86400)}d ago`;
  };

// Helper: get file type icon by extension
const getFileTypeIcon = (filename) => {
    const ext = filename.split('.').pop().toLowerCase();
  if (["jpg","jpeg","png","gif","bmp","svg","webp"].includes(ext)) return '📷';
    if (["pdf"].includes(ext)) return '📄';
  if (["doc","docx","odt","rtf"].includes(ext)) return '📝';
    if (["xls","xlsx","csv"].includes(ext)) return '📊';
  if (["ppt","pptx"].includes(ext)) return '📈';
  if (["zip","rar","7z","tar","gz"].includes(ext)) return '📦';
    if (["mp3","wav","ogg"].includes(ext)) return '🎵';
    if (["mp4","mov","avi","wmv","mkv"].includes(ext)) return '🎬';
    return '📎';
  };

// Helper: parse mentions from content
const parseMentions = (content) => {
  const mentionRegex = /@([A-Za-z_]+)/g;
  const mentions = [];
  let match;
  while ((match = mentionRegex.exec(content)) !== null) {
    mentions.push(match[1].replace(/_/g, ' '));
  }
  return mentions;
};

// Helper: highlight mentions in content for email display
const highlightMentions = (content) => {
  const mentionRegex = /@([A-Za-z_]+)/g;
  return content.replace(mentionRegex, (match, username) => {
    const displayName = username.replace(/_/g, ' ');
    return `<span style="background:#f3f4f6;color:#6B39E7;padding:2px 6px;border-radius:4px;font-weight:600;">@${displayName}</span>`;
  });
};

// Helper: parse taskDetails string to extract fields
const parseTaskDetails = (detailsHtml) => {
  const obj = {};
  if (!detailsHtml) return obj;
  // Use regex to extract <strong>Field:</strong> Value<br>
  const regex = /<strong>([^:]+):<\/strong>\s*([^<]*)<br>/g;
  let match;
  while ((match = regex.exec(detailsHtml)) !== null) {
    obj[match[1].trim()] = match[2].trim();
  }
  // Assigned Date (may not have <br> at end)
  const assignedDateMatch = detailsHtml.match(/<strong>Assigned Date:<\/strong>\s*([^<]*)/);
  if (assignedDateMatch) obj['Assigned Date'] = assignedDateMatch[1].trim();
  // Description
  const descMatch = detailsHtml.match(/<strong>Description:<\/strong>\s*([^<]*)<br>/);
  if (descMatch) obj['Description'] = descMatch[1].trim();
  return obj;
};

// Helper: format date for display
const formatDate = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  return date.toLocaleString('en-US', {
    month: '2-digit', day: '2-digit', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  });
};

// ===== PROFESSIONAL BADGE GENERATORS =====

// Priority badge generator - professional styling
const getPriorityBadge = (priority) => {
  let color = '#d97706', bg = '#fef3c7', border = '#fbbf24';
  if (priority === 'High') { color = '#dc2626'; bg = '#fee2e2'; border = '#f87171'; }
  else if (priority === 'Low') { color = '#16a34a'; bg = '#dcfce7'; border = '#4ade80'; }
  return `<span style="display:inline-block;padding:4px 12px;border-radius:6px;font-size:11px;font-weight:600;background:${bg};color:${color};margin-right:8px;border:1px solid ${border};text-transform:uppercase;letter-spacing:0.5px;">${priority}</span>`;
};

// Status badge generator - professional styling
const getStatusBadge = (status) => {
  let color = '#6B39E7', bg = '#f3f4f6', border = '#a78bfa', text = 'Assigned';
  if (status === 1) { color = '#6b7280'; bg = '#f9fafb'; border = '#d1d5db'; text = 'Not Assigned'; }
  else if (status === 3) { color = '#d97706'; bg = '#fef3c7'; border = '#fbbf24'; text = 'In Progress'; }
  else if (status === 4) { color = '#16a34a'; bg = '#dcfce7'; border = '#4ade80'; text = 'Completed'; }
  return `<span style="display:inline-block;padding:4px 12px;border-radius:6px;font-size:11px;font-weight:600;background:${bg};color:${color};border:1px solid ${border};text-transform:uppercase;letter-spacing:0.5px;">${text}</span>`;
};

// ===== PROFESSIONAL EMAIL TEMPLATE SECTIONS =====

// Project info section generator - clean and professional
const generateProjectSection = (project) => {
  return project ? `
    <div style="margin-bottom: 20px; padding: 16px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #6B39E7;">
      <div style="font-weight: 600; color: #6B39E7; font-size: 13px; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">Project</div>
      <div style="font-weight: 600; color: #1F1F1F; font-size: 16px; margin-bottom: 4px;">${project.Name}</div>
      ${project.Description ? `<div style="color:#6b7280;font-size:13px;line-height:1.4;">${project.Description}</div>` : ''}
    </div>
  ` : '';
};

// History section generator - clean and professional
const generateHistorySection = (historyItems) => {
  return historyItems && historyItems.length > 0 ? `
    <div style="margin-bottom: 20px;">
      <div style="font-weight: 600; color: #6B39E7; font-size: 13px; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Recent Activity</div>
      <div style="background: #ffffff; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden;">
        ${historyItems.map(h => `
          <div style="padding: 12px 16px; border-bottom: 1px solid #f3f4f6;">
            <div style="font-weight:500;color:#1F1F1F;font-size:13px;margin-bottom:4px;">${h.Type || 'Task'}${h.OldStatus !== undefined ? ` status changed from <b>${h.OldStatus}</b>` : ''}</div>
            <div style="color:#6b7280;font-size:11px;">${getTimeAgo(h.HistoryDate)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';
};

// Attachments section generator - clean and professional
const generateAttachmentsSection = (attachments) => {
  return attachments && attachments.length > 0 ? `
    <div style="margin-bottom: 20px;">
      <div style="font-weight: 600; color: #6B39E7; font-size: 13px; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Attachments</div>
      <div style="display: flex; flex-wrap: wrap; gap: 12px;">
        ${attachments.map(a => `
          <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:6px;padding:12px;min-width:160px;max-width:200px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
            <div style="font-size:16px;line-height:1.2;margin-bottom:8px;">${getFileTypeIcon(a.Filename)}</div>
            <a href="${a.FileURL}" style="color:#6B39E7;text-decoration:none;font-weight:600;display:block;word-break:break-all;font-size:12px;line-height:1.3;">${a.Filename}</a>
            <div style="color:#6b7280;font-size:10px;margin-top:4px;">${(a.FileSize/1024).toFixed(1)} KB • ${getTimeAgo(a.UploadedAt)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';
};

// Comments section generator - clean and professional
const generateCommentsSection = (comments) => {
  return comments && comments.length > 0 ? `
    <div style="margin-bottom: 20px;">
      <div style="font-weight: 600; color: #6B39E7; font-size: 13px; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Recent Comments</div>
      <div style="background: #ffffff; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden;">
        ${comments.map(c => `
          <div style="padding: 16px; border-bottom: 1px solid #f3f4f6;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span style="font-weight:600;color:#1F1F1F;font-size:13px;">${c.Author}</span>
              <span style="color:#6b7280;font-size:11px;">${getTimeAgo(c.CreatedAt)}</span>
            </div>
            <div style="color:#374151;font-size:13px;line-height:1.4;">${c.Content.length > 100 ? c.Content.slice(0,100)+'…' : c.Content}</div>
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';
};

// ===== PROFESSIONAL EMAIL FUNCTIONS =====

// Helper to send reset password email
async function sendResetEmail(to, username, link) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Reset Your Password - TeamLabs</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif; background-color: #f8fafc;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f8fafc;">
        <tr>
          <td align="center" style="padding: 40px 20px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 480px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
              <tr>
                <td style="padding: 40px 32px;">
                  <!-- Header -->
                  <div style="text-align: center; margin-bottom: 32px;">
                    <div style="font-size: 24px; font-weight: 700; color: #6B39E7; letter-spacing: -0.5px; margin-bottom: 8px;">TeamLabs</div>
                    <div style="width: 40px; height: 2px; background: #6B39E7; margin: 0 auto;"></div>
                  </div>
                  
                  <!-- Content -->
                  <h1 style="color: #1F1F1F; font-size: 20px; font-weight: 600; margin: 0 0 16px 0; text-align: center;">Reset Your Password</h1>
                  <p style="color: #6b7280; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0; text-align: center;">Hello <strong style="color: #1F1F1F;">${username}</strong>,</p>
                  <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0 0 32px 0; text-align: center;">We received a request to reset your password. Click the button below to set a new password. This link is valid for 24 hours.</p>
                  
                  <!-- CTA Button -->
                  <div style="text-align: center; margin-bottom: 32px;">
                    <a href="${link}" style="display: inline-block; background: #6B39E7; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-size: 15px; font-weight: 600;">Reset Password</a>
                  </div>
                  
                  <!-- Security Notice -->
                  <div style="background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; margin-bottom: 32px;">
                    <p style="color: #6b7280; font-size: 12px; line-height: 1.5; margin: 0; text-align: center;">If you did not request this, you can safely ignore this email. For security, this link will expire in 24 hours.</p>
      </div>
                  
                  <!-- Footer -->
                  <div style="text-align: center; padding-top: 24px; border-top: 1px solid #e5e7eb;">
                    <p style="color: #9ca3af; font-size: 11px; margin: 0;">&copy; ${new Date().getFullYear()} TeamLabs. All rights reserved.</p>
    </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  try {
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to,
      subject: 'Reset your TeamLabs password',
      html
    });
    return true;
  } catch (error) {
    console.error('Error sending reset password email:', error);
    return false;
  }
}

// Helper to send task assignment email
async function sendTaskAssignmentEmail(to, taskName, taskDetails, assignedBy, priority, status, taskType, taskId, project, historyItems, attachments, comments) {
  const taskUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/task/${taskId}`;
  const taskDetailsObj = parseTaskDetails(taskDetails);
  const assignedDateFormatted = formatDate(taskDetailsObj['Assigned Date']);

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>New ${taskType} Assigned - TeamLabs</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif; background-color: #f8fafc;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f8fafc;">
        <tr>
          <td align="center" style="padding: 40px 20px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 520px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
              <tr>
                <td style="padding: 40px 32px;">
                  <!-- Header -->
                  <div style="text-align: center; margin-bottom: 32px;">
                    <div style="font-size: 24px; font-weight: 700; color: #6B39E7; letter-spacing: -0.5px; margin-bottom: 8px;">TeamLabs</div>
                    <div style="width: 40px; height: 2px; background: #6B39E7; margin: 0 auto;"></div>
        </div>
                  
                  <!-- Content -->
                  <h1 style="color: #1F1F1F; font-size: 18px; font-weight: 600; margin: 0 0 16px 0;">New ${taskType} Assigned</h1>
                  <p style="color: #6b7280; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0;">Hello,</p>
                  <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;">You have been assigned a new ${taskType.toLowerCase()} by <strong style="color: #1F1F1F;">${assignedBy}</strong>.</p>
                  
        ${generateProjectSection(project)}
                  
                  <!-- Task Card -->
                  <div style="background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
                    <div style="font-size: 16px; font-weight: 600; color: #1F1F1F; margin-bottom: 16px; line-height: 1.3;">
            ${taskName}
          </div>
                    
                    <!-- Badges -->
                    <div style="margin-bottom: 16px;">
            ${getPriorityBadge(priority)}
            ${getStatusBadge(status)}
          </div>
                    
                    <!-- Task Details -->
                    <div style="background: #f8fafc; border-radius: 6px; padding: 16px; margin-bottom: 16px;">
                      <div style="font-size: 13px; color: #374151; line-height: 1.6;">
                        <div style="margin-bottom: 8px;"><span style="font-weight:600;color:#1F1F1F;">Description:</span> ${taskDetailsObj.Description || '—'}</div>
                        <div style="margin-bottom: 8px;"><span style="font-weight:600;color:#1F1F1F;">Type:</span> ${taskType}</div>
                        <div><span style="font-weight:600;color:#1F1F1F;">Assigned Date:</span> ${assignedDateFormatted}</div>
                      </div>
          </div>
                    
          ${generateHistorySection(historyItems)}
          ${generateAttachmentsSection(attachments)}
          ${generateCommentsSection(comments)}
                    
                    <!-- CTA Button -->
                    <div style="text-align: center; margin-top: 20px;">
                      <a href="${taskUrl}" style="display: inline-block; background: #6B39E7; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-size: 14px; font-weight: 600;">
                        View ${taskType}
            </a>
          </div>
        </div>
                  
                  <!-- Footer -->
                  <div style="text-align: center; padding-top: 24px; border-top: 1px solid #e5e7eb;">
                    <p style="color: #9ca3af; font-size: 11px; margin: 0;">Please log in to your TeamLabs account to view the complete ${taskType.toLowerCase()} details and update its status.</p>
                    <p style="color: #9ca3af; font-size: 11px; margin: 8px 0 0 0;">&copy; ${new Date().getFullYear()} TeamLabs. All rights reserved.</p>
        </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  try {
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to,
      subject: `${taskType}: ${taskName}`,
      html
    });
    return true;
  } catch (error) {
    console.error('Error sending task assignment email:', error);
    return false;
  }
}

// Helper to send comment mention email
async function sendCommentMentionEmail(to, mentionTo, commentContent, taskName, taskId, project, taskType, status, priority, mentionedBy) {
  const highlightedContent = highlightMentions(commentContent);
  const taskUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/task/${taskId}`;

  // Professional badge HTML generators
  const badgeStyle = 'display:inline-flex;align-items:center;justify-content:center;min-width:70px;max-width:110px;padding:4px 12px;border-radius:6px;font-size:11px;font-weight:600;margin-right:8px;box-sizing:border-box;line-height:1.2;border:1px solid;text-transform:uppercase;letter-spacing:0.5px;';

  // Task type badge
  const typeBadge = `<span style="${badgeStyle}background:#fef3c7;color:#d97706;border-color:#fbbf24;">${taskType}</span>`;
  
  // Priority badge
  let priorityBadge = '';
  if (priority) {
    let color = '#d97706', bg = '#fef3c7', border = '#fbbf24';
    if (priority === 'High') { color = '#dc2626'; bg = '#fee2e2'; border = '#f87171'; }
    else if (priority === 'Low') { color = '#16a34a'; bg = '#dcfce7'; border = '#4ade80'; }
    priorityBadge = `<span style="${badgeStyle}background:${bg};color:${color};border-color:${border};">${priority}</span>`;
  }
  
  // Status badge
  let statusBadge = '';
  if (status !== undefined && status !== null) {
    let color = '#6B39E7', bg = '#f3f4f6', border = '#a78bfa', text = 'Assigned';
    if (status === 1) { color = '#6b7280'; bg = '#f9fafb'; border = '#d1d5db'; text = 'Not Assigned'; }
    else if (status === 3) { color = '#d97706'; bg = '#fef3c7'; border = '#fbbf24'; text = 'In Progress'; }
    else if (status === 4) { color = '#16a34a'; bg = '#dcfce7'; border = '#4ade80'; text = 'Completed'; }
    statusBadge = `<span style="${badgeStyle}background:${bg};color:${color};border-color:${border};">${text}</span>`;
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>You were mentioned in a comment - TeamLabs</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif; background-color: #f8fafc;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f8fafc;">
        <tr>
          <td align="center" style="padding: 40px 20px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 520px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
              <tr>
                <td style="padding: 40px 32px;">
                  <!-- Header -->
                  <div style="text-align: center; margin-bottom: 32px;">
                    <div style="font-size: 24px; font-weight: 700; color: #6B39E7; letter-spacing: -0.5px; margin-bottom: 8px;">TeamLabs</div>
                    <div style="width: 40px; height: 2px; background: #6B39E7; margin: 0 auto;"></div>
        </div>
                  
                  <!-- Content -->
                  <h1 style="color: #1F1F1F; font-size: 18px; font-weight: 600; margin: 0 0 16px 0;">You were mentioned in a comment</h1>
                  <p style="color: #6b7280; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0;">Hello <strong style="color: #1F1F1F;">${mentionTo}</strong>,</p>
                  <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;"><strong style="color: #1F1F1F;">${mentionedBy}</strong> mentioned you in a comment on a ${String(taskType || '').toLowerCase()}.</p>
                  
        ${generateProjectSection(project)}
                  
                  <!-- Task Card -->
                  <div style="background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
                    <div style="font-size: 16px; font-weight: 600; color: #1F1F1F; margin-bottom: 16px; line-height: 1.3;">
            ${taskName}
          </div>
                    
                    <!-- Badges -->
                    <div style="margin-bottom: 16px;">
                      <table cellpadding="0" cellspacing="0" border="0" style="border:none;padding:0;margin:0;">
                        <tr>
              <td>${typeBadge}</td>
              ${priorityBadge ? `<td>${priorityBadge}</td>` : ''}
              ${statusBadge ? `<td>${statusBadge}</td>` : ''}
                        </tr>
                      </table>
          </div>
                    
                    <!-- Comment -->
                    <div style="background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; margin-bottom: 16px;">
                      <div style="font-size: 13px; color: #374151; line-height: 1.6;">
              ${highlightedContent}
            </div>
                      <div style="margin-top: 12px; color: #6b7280; font-size: 11px;">
              — ${mentionedBy} • ${getTimeAgo(new Date())}
            </div>
          </div>
                    
                    <!-- CTA Button -->
                    <div style="text-align: center; margin-top: 20px;">
                      <a href="${taskUrl}" style="display: inline-block; background: #6B39E7; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-size: 14px; font-weight: 600;">
                        View Comment
            </a>
          </div>
        </div>
                  
                  <!-- Footer -->
                  <div style="text-align: center; padding-top: 24px; border-top: 1px solid #e5e7eb;">
                    <p style="color: #9ca3af; font-size: 11px; margin: 0;">Click the button above to view the complete comment and respond if needed.</p>
                    <p style="color: #9ca3af; font-size: 11px; margin: 8px 0 0 0;">&copy; ${new Date().getFullYear()} TeamLabs. All rights reserved.</p>
        </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  try {
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to,
      subject: `You were mentioned in a comment on ${taskName}`,
      html
    });
    return true;
  } catch (error) {
    console.error('Error sending comment mention email:', error);
    return false;
  }
}

// Send invite email
async function sendInviteEmail(to, inviteLink, inviterName) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>You're Invited to Join TeamLabs</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif; background-color: #f8fafc;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f8fafc;">
        <tr>
          <td align="center" style="padding: 40px 20px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 480px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
              <tr>
                <td style="padding: 40px 32px;">
                  <!-- Header -->
                  <div style="text-align: center; margin-bottom: 32px;">
                    <div style="font-size: 24px; font-weight: 700; color: #6B39E7; letter-spacing: -0.5px; margin-bottom: 8px;">TeamLabs</div>
                    <div style="width: 40px; height: 2px; background: #6B39E7; margin: 0 auto;"></div>
                  </div>
                  
                  <!-- Content -->
                  <h1 style="color: #1F1F1F; font-size: 20px; font-weight: 600; margin: 0 0 16px 0; text-align: center;">You're Invited to Join TeamLabs</h1>
                  <p style="color: #6b7280; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0; text-align: center;">Hello,</p>
                  <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0 0 32px 0; text-align: center;"><strong style="color: #1F1F1F;">${inviterName}</strong> has invited you to join their organization on TeamLabs. Click the button below to register and join the team.</p>
                  
                  <!-- CTA Button -->
                  <div style="text-align: center; margin-bottom: 32px;">
                    <a href="${inviteLink}" style="display: inline-block; background: #6B39E7; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-size: 15px; font-weight: 600;">Accept Invite & Register</a>
                  </div>
                  
                  <!-- Security Notice -->
                  <div style="background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; margin-bottom: 32px;">
                    <p style="color: #6b7280; font-size: 12px; line-height: 1.5; margin: 0; text-align: center;">If you did not expect this invitation, you can safely ignore this email.</p>
      </div>
                  
                  <!-- Footer -->
                  <div style="text-align: center; padding-top: 24px; border-top: 1px solid #e5e7eb;">
                    <p style="color: #9ca3af; font-size: 11px; margin: 0;">&copy; ${new Date().getFullYear()} TeamLabs. All rights reserved.</p>
    </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
  
  try {
  await transporter.sendMail({
    from: process.env.GMAIL_USER,
    to,
    subject: 'You are invited to join TeamLabs',
    html
  });
    return true;
  } catch (error) {
    console.error('Error sending invite email:', error);
    return false;
  }
}

module.exports = {
  sendResetEmail,
  sendTaskAssignmentEmail,
  sendCommentMentionEmail,
  sendInviteEmail
}; 