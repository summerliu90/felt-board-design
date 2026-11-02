import { navigate } from '../App'

/** Plain navigation without a product mark or wordmark. */
export function HomeLink() {
  return <a href="/" aria-label="返回首页" className="text-sm text-ink-2 no-underline hover:text-accent" onClick={event=>{event.preventDefault();navigate('/')}}>返回首页</a>
}
