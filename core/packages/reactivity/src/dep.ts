import { ReactiveEffect, trackOpBit } from './effect'

export type Dep = Set<ReactiveEffect> & TrackedMarkers

/**
 * wasTracked and newTracked maintain the status for several levels of effect
 * tracking recursion. One bit per level is used to define whether the dependency
 * was/is tracked.
 * wasTracked 和 newTracked 维护几个级别效果的状态
 * 跟踪递归。 每层一位用于定义是否依赖
 * 被/被跟踪。
 */
type TrackedMarkers = {
  /**
   * wasTracked
   */
  w: number
  /**
   * newTracked
   */
  n: number
}
// From track:
// Return To track: 创建一个set集合，并且set集合有两个关于响应式性能优化的属性w和n
export const createDep = (effects?: ReactiveEffect[]): Dep => {
  // 创建一个新的set集合dep，并添加两个属性w,n
  const dep = new Set<ReactiveEffect>(effects) as Dep
  // w表示是否已经被收集
  dep.w = 0
  // n表示是否是新收集的
  dep.n = 0
  return dep
}
// From trackEffects:
// Return To trackEffects: 看dep.w和递归层数是否相同，如果相同，则说明dep.w已经被收集，返回true，如果不同，返回false
export const wasTracked = (dep: Dep): boolean => (dep.w & trackOpBit) > 0
// From trackEffects:
// Return To trackEffects: 返回dep.n & trackOpBit > 0的结果，也就是说，当有值的时候  如下  000010 & 000010 这样，代表新收集
export const newTracked = (dep: Dep): boolean => (dep.n & trackOpBit) > 0
// From effect.run:
// Return To effect.run: 初始化deps的w属性，代表已经收集依赖
export const initDepMarkers = ({ deps }: ReactiveEffect) => {
  // 如果deps不为空
  if (deps.length) {
    // 遍历dpes
    for (let i = 0; i < deps.length; i++) {
      // 给每个dep的w属性进行 | 运算，代表相对应层次的已经收集依赖
      deps[i].w |= trackOpBit // set was tracked
    }
  }
}
// From effect.run:
// Return To effect.run: 遍历deps，删除曾经被收集过但不是新的依赖，将新的依赖添加到deps中，最后得到的就是删除不必要的旧依赖后的deps
export const finalizeDepMarkers = (effect: ReactiveEffect) => {
  // 解构出effect中的deps
  const { deps } = effect
  // 如果deps不为空
  if (deps.length) {
    // 索引
    let ptr = 0
    // 遍历deps
    for (let i = 0; i < deps.length; i++) {
      // 取得dep
      const dep = deps[i]
      // 曾经被收集过但不是新的依赖，需要删除
      if (wasTracked(dep) && !newTracked(dep)) {
        // 删除依赖
        dep.delete(effect)
      } else {
        // 如果是新收集的依赖，则放入deps中
        deps[ptr++] = dep
      }
      // clear bits
      // 清空状态
      dep.w &= ~trackOpBit
      dep.n &= ~trackOpBit
    }
    // deps数组长度等于删除不必要依赖之后的长度
    deps.length = ptr
  }
}
