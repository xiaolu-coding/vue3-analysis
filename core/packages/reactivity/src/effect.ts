import { TrackOpTypes, TriggerOpTypes } from './operations'
import { extend, isArray, isIntegerKey, isMap } from '@vue/shared'
import { EffectScope, recordEffectScope } from './effectScope'
import {
  createDep,
  Dep,
  finalizeDepMarkers,
  initDepMarkers,
  newTracked,
  wasTracked
} from './dep'
import { ComputedRefImpl } from './computed'

// The main WeakMap that stores {target -> key -> dep} connections.
// Conceptually, it's easier to think of a dependency as a Dep class
// which maintains a Set of subscribers, but we simply store them as
// raw Sets to reduce memory overhead.
type KeyToDepMap = Map<any, Dep>
const targetMap = new WeakMap<any, KeyToDepMap>()

// The number of effects currently being tracked recursively.
// 当前正在递归跟踪的效果数。
let effectTrackDepth = 0
// 递归嵌套层数
export let trackOpBit = 1

/**
 * The bitwise track markers support at most 30 levels of recursion.
 * This value is chosen to enable modern JS engines to use a SMI on all platforms.
 * When recursion depth is greater, fall back to using a full cleanup.
 * 按位跟踪标记最多支持 30 级递归。
 * 选择此值是为了使现代 JS 引擎能够在所有平台上使用 SMI。
 * 当递归深度更大时，回退到使用完全清理。
 */
const maxMarkerBits = 30

export type EffectScheduler = (...args: any[]) => any

export type DebuggerEvent = {
  effect: ReactiveEffect
} & DebuggerEventExtraInfo

export type DebuggerEventExtraInfo = {
  target: object
  type: TrackOpTypes | TriggerOpTypes
  key: any
  newValue?: any
  oldValue?: any
  oldTarget?: Map<any, any> | Set<any>
}

export let activeEffect: ReactiveEffect | undefined

export const ITERATE_KEY = Symbol(__DEV__ ? 'iterate' : '')
export const MAP_KEY_ITERATE_KEY = Symbol(__DEV__ ? 'Map key iterate' : '')

export class ReactiveEffect<T = any> {
  active = true
  deps: Dep[] = []
  parent: ReactiveEffect | undefined = undefined

  /**
   * Can be attached after creation
   * @internal
   */
  computed?: ComputedRefImpl<T>
  /**
   * @internal
   */
  allowRecurse?: boolean

  onStop?: () => void
  // dev only
  onTrack?: (event: DebuggerEvent) => void
  // dev only
  onTrigger?: (event: DebuggerEvent) => void

  constructor(
    public fn: () => T,
    public scheduler: EffectScheduler | null = null,
    scope?: EffectScope
  ) {
    recordEffectScope(this, scope)
  }
  // From triggerEffects:
  run() {
    // 如果当前不是活跃的
    if (!this.active) {
      // 返回fn fn是effect函数传入的参数，通常是更新函数也就是副作用函数
      return this.fn()
    }
    //todo parent的操作涉及effectScope
    let parent: ReactiveEffect | undefined = activeEffect
    let lastShouldTrack = shouldTrack
    while (parent) {
      if (parent === this) {
        return
      }
      parent = parent.parent
    }
    try {
      // 取得effect
      this.parent = activeEffect
      // 将this赋给activeEffect
      activeEffect = this
      // 将shouldTrack置为true
      shouldTrack = true
      // 使用左移运算符来表示递归的层数
      // effectTrackDepth初始为0 ++之后为1  1 << 1 = 2
      // 位运算如下: 0000001 左移一位   0000010 此时代表调用了一次effect
      // 使用位运算可以处理嵌套的effect
      trackOpBit = 1 << ++effectTrackDepth
      // 如果effectTrackDepth <= 30 调用initDepMarkers，否则降级到cleanupEffect
      if (effectTrackDepth <= maxMarkerBits) {
        // From effect.run:
        // To initDepMarkers:
        // Return From initDepMarkers: 初始化deps的w属性，代表已经收集依赖
        initDepMarkers(this)
      } else {
        // 执行cleanupEffect
        // From: run
        // To: cleanupEffect
        // Return From cleanupEffect: 清空依赖
        cleanupEffect(this)
      }
      // 返回fn fn是effect函数传入的参数，通常是更新函数也就是副作用函数
      return this.fn()
    } finally {
      // 如果effectTrackDepth <= 30 调用finalizeDepMarkers
      if (effectTrackDepth <= maxMarkerBits) {
        // From effect.run:
        // To: finalizeDepMarkers
        // Return from finalizeDepMarkers: 遍历deps，删除曾经被收集过但不是新的依赖，将新的依赖添加到deps中，最后得到的就是删除不必要的旧依赖后的deps
        finalizeDepMarkers(this)
      }
      // 递归层数恢复到上一级
      trackOpBit = 1 << --effectTrackDepth
      // 涉及effectScope
      activeEffect = this.parent
      shouldTrack = lastShouldTrack
      this.parent = undefined
    }
  }

  stop() {
    if (this.active) {
      cleanupEffect(this)
      if (this.onStop) {
        this.onStop()
      }
      this.active = false
    }
  }
}
// From effect.run:
// Return To run: 清空对应依赖
function cleanupEffect(effect: ReactiveEffect) {
  // 解构出deps数组，trackEffects中activeEffect!.deps.push(dep)这一步就是为了这里
  const { deps } = effect
  // 如果deps不为空
  if (deps.length) {
    // 遍历deps
    for (let i = 0; i < deps.length; i++) {
      // 将每一个dep中的effect依赖(副作用函数)移除
      deps[i].delete(effect)
    }
    // 长度置为0
    deps.length = 0
  }
}

export interface DebuggerOptions {
  onTrack?: (event: DebuggerEvent) => void
  onTrigger?: (event: DebuggerEvent) => void
}

export interface ReactiveEffectOptions extends DebuggerOptions {
  lazy?: boolean
  scheduler?: EffectScheduler
  scope?: EffectScope
  allowRecurse?: boolean
  onStop?: () => void
}

export interface ReactiveEffectRunner<T = any> {
  (): T
  effect: ReactiveEffect
}

export function effect<T = any>(
  fn: () => T,
  options?: ReactiveEffectOptions
): ReactiveEffectRunner {
  if ((fn as ReactiveEffectRunner).effect) {
    fn = (fn as ReactiveEffectRunner).effect.fn
  }

  const _effect = new ReactiveEffect(fn)
  if (options) {
    extend(_effect, options)
    if (options.scope) recordEffectScope(_effect, options.scope)
  }
  if (!options || !options.lazy) {
    _effect.run()
  }
  const runner = _effect.run.bind(_effect) as ReactiveEffectRunner
  runner.effect = _effect
  return runner
}

export function stop(runner: ReactiveEffectRunner) {
  runner.effect.stop()
}
// 是否收集依赖
export let shouldTrack = true
const trackStack: boolean[] = []
// From createArrayInstrumentations:
// Retrun to createArrayInstrumentations: 停止依赖收集
export function pauseTracking() {
  // 将shouldTrack入栈trackStack
  trackStack.push(shouldTrack)
  shouldTrack = false
}

export function enableTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = true
}
// From createArrayInstrumentations:
// Retrun to createArrayInstrumentations: 重启依赖收集
export function resetTracking() {
  // 将shouldTrack出栈trackStack
  const last = trackStack.pop()
  // shouldTrack为true
  shouldTrack = last === undefined ? true : last
}
// From createGetter:
// Return To createGetter: 创建依赖集合，trackEffects收集依赖
export function track(target: object, type: TrackOpTypes, key: unknown) {
  // 判断shouldTrack和activeEffect
  if (shouldTrack && activeEffect) {
    // 这一整步是为了创建依赖集合，像这样的结构 targetMap: {target -> key -> dep -> effect}
    // targetMap是WeakMap类型，depsMap是Map类型，dep是Set类型
    // targetMap的key值是target，value值是depsMap
    // depsMap的key值是key，value值是dep
    // dep的key值是effect，也就是ReactiveEffect
    // 因此形成了相对应的依赖集合，这个会细说
    let depsMap = targetMap.get(target)
    // 不存在时，初始化依赖集合
    if (!depsMap) {
      targetMap.set(target, (depsMap = new Map()))
    }
    let dep = depsMap.get(key)
    // 不存在时，初始化依赖集合
    if (!dep) {
      // From track:
      // To createDep:
      // Return From createDep: 创建一个set集合，并且set集合有两个关于响应式性能优化的属性w和n
      depsMap.set(key, (dep = createDep()))
    }
    // DEV忽略
    const eventInfo = __DEV__
      ? { effect: activeEffect, target, type, key }
      : undefined
    // 执行trackEffects，进行依赖的添加
    // From track:
    // To trackEffects:
    // Return From trackEffects: 收集依赖 将activeEffect添加到dep中，并且将dep添加到activeEffect.deps中,deps就是一个与当前副作用函数存在联系的依赖集合，为了在清理时能够知道是否需要清理
    trackEffects(dep, eventInfo)
  }
}
// From track:
// Return To track: 将activeEffect添加到dep中，并且将dep添加到activeEffect.deps中,deps就是一个与当前副作用函数存在联系的依赖集合，为了在清理时能够知道是否需要清理
export function trackEffects(
  dep: Dep,
  debuggerEventExtraInfo?: DebuggerEventExtraInfo
) {
  // 将shouldTrack置为false
  let shouldTrack = false
  // 如果effectTrackDepth <= 30 没有超过最大递归层数
  if (effectTrackDepth <= maxMarkerBits) {
    // From trackEffects:
    // To newTracked:
    // Retrun From newTracked: 判断是否是新的依赖
    // 如果不是新的依赖
    if (!newTracked(dep)) {
      // 设置为新的依赖
      dep.n |= trackOpBit // set newly tracked
      // From trackEffects:
      // To wasTracked:
      // Reutrn from wasTracked: 判断是否是已经收集的依赖
      // 如果已经收集了，shouldTrack为false，如果没有收集shuoldTrack为true
      shouldTrack = !wasTracked(dep)
    }
  } else {
    // Full cleanup mode.
    // 完全清理模式。
    // 如果Dep有activeEffect，shouldTrack为false，代表不用收集，如果没有，则需要收集
    shouldTrack = !dep.has(activeEffect!)
  }
  // 判断shouldTrack
  if (shouldTrack) {
    // 如果shouldTrack为true，则将activeEffect添加到dep中
    dep.add(activeEffect!)
    // 并且将dep添加到activeEffect.deps中， deps就是一个与当前副作用函数存在联系的依赖集合，为了在清理时能够知道是否需要清理
    activeEffect!.deps.push(dep)
    // DER忽略
    if (__DEV__ && activeEffect!.onTrack) {
      activeEffect!.onTrack(
        Object.assign(
          {
            effect: activeEffect!
          },
          debuggerEventExtraInfo
        )
      )
    }
  }
}
// From createSetter:
// Return To createSetter: 将相对应的副作用函数(effect)推入到deps数组中，然后triggerEffects去遍历执行副作用函数
export function trigger(
  target: object,
  type: TriggerOpTypes,
  key?: unknown,
  newValue?: unknown,
  oldValue?: unknown,
  oldTarget?: Map<unknown, unknown> | Set<unknown>
) {
  // 获取depsMap
  const depsMap = targetMap.get(target)
  // 如果depsMap不存在
  if (!depsMap) {
    // never been tracked
    // 从未被追踪，返回
    return
  }
  // 创建deps数组
  let deps: (Dep | undefined)[] = []
  // 如果type为CLEAR
  if (type === TriggerOpTypes.CLEAR) {
    // collection being cleared
    // trigger all effects for target
    // 集合被清空
    // 触发所有的依赖
    // 展开target里的所有值，并values执行get，触发所有依赖
    deps = [...depsMap.values()]
    // 如果target是数组并且修改了数组的length属性
  } else if (key === 'length' && isArray(target)) {
    // 遍历副作用函数，找出需要的副作用函数
    depsMap.forEach((dep, key) => {
      // 只有索引值大于等于length时，才需要添加到deps数组中 例如 一个数组有5个元素，你通过arr.length = 3改变数组，此时数组需要更新，但是arr.length = 7，不需要更新 
      if (key === 'length' || key >= (newValue as number)) {
        deps.push(dep)
      }
    })
  } else {
    // schedule runs for SET | ADD | DELETE
    if (key !== void 0) {
      deps.push(depsMap.get(key))
    }

    // also run for iteration key on ADD | DELETE | Map.SET
    switch (type) {
      // 当类型为ADD时，新增
      case TriggerOpTypes.ADD:
        // 如果target不是数组
        if (!isArray(target)) {
          //todo: ADD操作会使对象的键变多，会影响到for in循环的此处，因此取出与ITERATE_KEY关联的副作用函数，推入到deps数组中 (这里的ITERATE_KEY涉及ownKeys for in循环)
          deps.push(depsMap.get(ITERATE_KEY))
          // 如果target是map类型
          if (isMap(target)) {
            // ADD操作会使map的size属性变化，因此取出与MAP_KEY_ITERATE_KEY关联的副作用函数，推入到deps数组中
            deps.push(depsMap.get(MAP_KEY_ITERATE_KEY))
          }
        } else if (isIntegerKey(key)) {
          // target是数组，并且key是正整数
          // ADD操作会使数组的length属性变化，因此取出与length属性相关的副作用函数，推入到deps数组中
          // new index added to array -> length changes
          deps.push(depsMap.get('length'))
        }
        break
      // 当类型为DELETE时
      case TriggerOpTypes.DELETE:
        // 如果target不是数组
        if (!isArray(target)) {
          // DELETE操作会使对象的键变少，会影响到for in循环的次数， 因此又要取出取出与ITERATE_KEY关联的副作用函数，推入到deps数组中
          deps.push(depsMap.get(ITERATE_KEY))
          // 如果target是map类型
          if (isMap(target)) {
            // DELETE操作会使map的size属性变化，因此取出与MAP_KEY_ITERATE_KEY关联的副作用函数，推入到deps数组中
            deps.push(depsMap.get(MAP_KEY_ITERATE_KEY))
          }
        }
        break
      // 当类型为SET时 
      case TriggerOpTypes.SET:
        // 如果target是map类型
        if (isMap(target)) {
          // SET操作会使map的变化，因此取出与ITERATE_KEY关联的副作用函数，推入到deps数组中
          deps.push(depsMap.get(ITERATE_KEY))
        }
        break
    }
  }
  // DEV忽略
  const eventInfo = __DEV__
    ? { target, type, key, newValue, oldValue, oldTarget }
    : undefined
  // 判断deps数组是否只有一个，也就是只有一个副作用函数
  if (deps.length === 1) {
    if (deps[0]) {
      // DEV忽略
      if (__DEV__) {
        triggerEffects(deps[0], eventInfo)
      } else {
        // 执行triggerEffects
        triggerEffects(deps[0])
      }
    }
  } else {
    // 如果不止一个副作用函数
    const effects: ReactiveEffect[] = []
    // 遍历deps数组
    for (const dep of deps) {
      if (dep) {
        // 将dep推入到effects中
        effects.push(...dep)
      }
    }
    // DEV忽略
    if (__DEV__) {
      triggerEffects(createDep(effects), eventInfo)
    } else {
      // 涉及到set规范 执行triggerEffects
      // From trigger:
      // To triggerEffects:
      // Reutrn From triggerEffects: 循环所用的副作用函数，根据有无调度器，使用不同方式执行副作用函数
      triggerEffects(createDep(effects))
    }
  }
}
// From trigger:
// Return To createSetter: 循环所用的副作用函数，根据有无调度器，使用不同方式执行副作用函数
export function triggerEffects(
  dep: Dep | ReactiveEffect[],
  debuggerEventExtraInfo?: DebuggerEventExtraInfo
) {
  // spread into array for stabilization
  // 找到相关依赖，循环所有的副作用函数
  for (const effect of isArray(dep) ? dep : [...dep]) {
    // 如果trigger触发执行的副作用函数与现在正在执行的副作用函数相同，则不触发执行
    if (effect !== activeEffect || effect.allowRecurse) {
      // DEV忽略
      if (__DEV__ && effect.onTrigger) {
        effect.onTrigger(extend({ effect }, debuggerEventExtraInfo))
      }
      // 如果一个副作用函数存在调度器
      if (effect.scheduler) {
        // 则调用该调度器，并将副作用函数作为参数传递
        effect.scheduler()
      } else {
        // 否则直接执行副作用函数
        effect.run()
      }
    }
  }
}
