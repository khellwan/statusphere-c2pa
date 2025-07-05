import type { Status, Post } from '#/db'
import { html } from '../lib/view'
import { shell } from './shell'

const TODAY = new Date().toDateString()

const STATUS_OPTIONS = [
  '👍',
  '👎',
  '💙',
  '🥹',
  '😧',
  '😤',
  '🙃',
  '😉',
  '😎',
  '🤓',
  '🤨',
  '🥳',
  '😭',
  '😤',
  '🤯',
  '🫡',
  '💀',
  '✊',
  '🤘',
  '👀',
  '🧠',
  '👩‍💻',
  '🧑‍💻',
  '🥷',
  '🧌',
  '🦋',
  '🚀',
]

type Props = {
  statuses: Status[]
  posts: Post[]
  didHandleMap: Record<string, string>
  profile?: { displayName?: string }
  myStatus?: Status
  myLatestPost?: Post
}

export function home(props: Props) {
  return shell({
    title: 'Home',
    content: content(props),
  })
}

function content({ statuses, posts, didHandleMap, profile, myStatus, myLatestPost }: Props) {
  return html`<div id="root">
    <div class="error"></div>
    <div id="header">
      <h1>Statusphere</h1>
      <p>Share your thoughts on the Atmosphere.</p>
    </div>
    <div class="container">
      <div class="card">
        ${profile
          ? html`<form action="/logout" method="post" class="session-form">
              <div>
                Hi, <strong>${profile.displayName || 'friend'}</strong>. What's on your mind?
              </div>
              <div>
                <button type="submit">Log out</button>
              </div>
            </form>`
          : html`<div class="session-form">
              <div><a href="/login">Log in</a> to share your thoughts!</div>
              <div>
                <a href="/login" class="button">Log in</a>
              </div>
            </div>`}
      </div>
      
      ${profile ? html`
        <!-- Post Composer -->
        <div class="card post-composer">
          <div class="composer-tabs">
            <button type="button" class="tab-btn active" onclick="switchTab('post')">
              💬 Post
            </button>
            <button type="button" class="tab-btn" onclick="switchTab('status')">
              😀 Status
            </button>
          </div>
          
          <!-- Post Form -->
          <form action="/post" method="post" class="post-form" id="post-form">
            <textarea 
              name="text" 
              placeholder="What's happening?"
              maxlength="300"
              rows="3"
              class="post-textarea"
              oninput="updateCharCount(this)"
            ></textarea>
            <div class="post-tools">
              <div class="char-count">
                <span id="char-count">0</span>/300
              </div>
              <button type="submit" class="post-btn" disabled>Post</button>
            </div>
          </form>
          
          <!-- Status Form (Hidden by default) -->
          <form action="/status" method="post" class="status-options" id="status-form" style="display: none;">
            ${STATUS_OPTIONS.map(
              (status) =>
                html`<button
                  class=${myStatus?.status === status
                    ? 'status-option selected'
                    : 'status-option'}
                  name="status"
                  value="${status}"
                >
                  ${status}
                </button>`
            )}
          </form>
        </div>
      ` : ''}
      
      <!-- Timeline -->
      <div class="timeline">
        ${renderTimeline(posts, statuses, didHandleMap)}
      </div>
    </div>
    
    <script>
      function switchTab(tab) {
        const postForm = document.getElementById('post-form');
        const statusForm = document.getElementById('status-form');
        const tabs = document.querySelectorAll('.tab-btn');
        
        tabs.forEach(t => t.classList.remove('active'));
        
        if (tab === 'post') {
          postForm.style.display = 'block';
          statusForm.style.display = 'none';
          document.querySelector('[onclick="switchTab(\\'post\\')"]').classList.add('active');
        } else {
          postForm.style.display = 'none';
          statusForm.style.display = 'flex';
          document.querySelector('[onclick="switchTab(\\'status\\')"]').classList.add('active');
        }
      }
      
      function updateCharCount(textarea) {
        const count = textarea.value.length;
        const counter = document.getElementById('char-count');
        const button = document.querySelector('.post-btn');
        
        counter.textContent = count;
        counter.style.color = count > 280 ? '#f00' : count > 240 ? '#f80' : '#666';
        
        button.disabled = count === 0 || count > 300;
      }
    </script>
  </div>`
}

function toBskyLink(did: string) {
  return `https://bsky.app/profile/${did}`
}

function ts(status: Status) {
  const createdAt = new Date(status.createdAt)
  const indexedAt = new Date(status.indexedAt)
  if (createdAt < indexedAt) return createdAt.toDateString()
  return indexedAt.toDateString()
}

function renderTimeline(posts: Post[], statuses: Status[], didHandleMap: Record<string, string>) {
  // Combine posts and statuses into a unified timeline
  const timelineItems = [
    ...posts.map(post => ({ type: 'post' as const, data: post, createdAt: post.createdAt })),
    ...statuses.map(status => ({ type: 'status' as const, data: status, createdAt: status.createdAt }))
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return html`${timelineItems.map((item, i) => {
    const handle = didHandleMap[item.data.authorDid] || item.data.authorDid
    const date = formatDate(item.createdAt)
    
    if (item.type === 'post') {
      const post = item.data as Post
      return html`
        <div class=${i === 0 ? 'post-item no-line' : 'post-item'}>
          <div class="post-avatar">
            💬
          </div>
          <div class="post-content">
            <div class="post-header">
              <a class="author" href=${toBskyLink(handle)}>@${handle}</a>
              <span class="date">${date}</span>
            </div>
            <div class="post-text">${formatPostText(post.text)}</div>
            ${post.langs ? html`<div class="post-langs">${JSON.parse(post.langs).join(', ')}</div>` : ''}
          </div>
        </div>
      `
    } else {
      const status = item.data as Status
      return html`
        <div class=${i === 0 ? 'status-line no-line' : 'status-line'}>
          <div>
            <div class="status">${status.status}</div>
          </div>
          <div class="desc">
            <a class="author" href=${toBskyLink(handle)}>@${handle}</a>
            ${date === TODAY
              ? `is feeling ${status.status} today`
              : `was feeling ${status.status} on ${date}`}
          </div>
        </div>
      `
    }
  })}`
}

function formatPostText(text: string) {
  // Basic text formatting - will be enhanced later with facets
  return text
    .replace(/\n/g, '<br>')
    .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/@([a-zA-Z0-9.-]+)/g, '<span class="mention">@$1</span>')
    .replace(/#([a-zA-Z0-9_]+)/g, '<span class="hashtag">#$1</span>')
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 1) return 'now'
  if (diffMins < 60) return `${diffMins}m`
  if (diffHours < 24) return `${diffHours}h`
  if (diffDays < 7) return `${diffDays}d`
  return date.toLocaleDateString()
}
