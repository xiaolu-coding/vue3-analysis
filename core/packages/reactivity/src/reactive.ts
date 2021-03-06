import { isObject, toRawType, def } from '@vue/shared'
import {
  mutableHandlers,
  readonlyHandlers,
  shallowReactiveHandlers,
  shallowReadonlyHandlers
} from './baseHandlers'
import {
  mutableCollectionHandlers,
  readonlyCollectionHandlers,
  shallowCollectionHandlers,
  shallowReadonlyCollectionHandlers
} from './collectionHandlers'
import { UnwrapRefSimple, Ref } from './ref'

export const enum ReactiveFlags {
  SKIP = '__v_skip',
  IS_REACTIVE = '__v_isReactive',
  IS_READONLY = '__v_isReadonly',
  IS_SHALLOW = '__v_isShallow',
  RAW = '__v_raw'
}

export interface Target {
  [ReactiveFlags.SKIP]?: boolean
  [ReactiveFlags.IS_REACTIVE]?: boolean
  [ReactiveFlags.IS_READONLY]?: boolean
  [ReactiveFlags.IS_SHALLOW]?: boolean
  [ReactiveFlags.RAW]?: any
}

export const reactiveMap = new WeakMap<Target, any>()
export const shallowReactiveMap = new WeakMap<Target, any>()
export const readonlyMap = new WeakMap<Target, any>()
export const shallowReadonlyMap = new WeakMap<Target, any>()

const enum TargetType {
  INVALID = 0,
  COMMON = 1,
  COLLECTION = 2
}

function targetTypeMap(rawType: string) {
  switch (rawType) {
    case 'Object':
    case 'Array':
      return TargetType.COMMON
    case 'Map':
    case 'Set':
    case 'WeakMap':
    case 'WeakSet':
      return TargetType.COLLECTION
    default:
      return TargetType.INVALID
  }
}
// From createReactiveObject:
// Return To createReactiveObject: 返回target相对应的类型
function getTargetType(value: Target) {
  // 如果是Skip或者是不可扩展的对象，直接返回INVALID，否则返回toRawType
  // To toRawType:
  // Return From toRawType: 从“[object RawType]”之类的字符串中提取“RawType”
  return value[ReactiveFlags.SKIP] || !Object.isExtensible(value)
    ? TargetType.INVALID
    : targetTypeMap(toRawType(value))
}

// only unwrap nested ref
export type UnwrapNestedRefs<T> = T extends Ref ? T : UnwrapRefSimple<T>

/**
 * Creates a reactive copy of the original object.
 *
 * The reactive conversion is "deep"—it affects all nested properties. In the
 * ES2015 Proxy based implementation, the returned proxy is **not** equal to the
 * original object. It is recommended to work exclusively with the reactive
 * proxy and avoid relying on the original object.
 *
 * A reactive object also automatically unwraps refs contained in it, so you
 * don't need to use `.value` when accessing and mutating their value:
 *
 * ```js
 * const count = ref(0)
 * const obj = reactive({
 *   count
 * })
 *
 * obj.count++
 * obj.count // -> 1
 * count.value // -> 1
 * ```
 */
// From setup
// Return To setup: 返回经过handlers处理后的proxy代理对象target
export function reactive<T extends object>(target: T): UnwrapNestedRefs<T>
export function reactive(target: object) {
  // if trying to observe a readonly proxy, return the readonly version.
  // 如果是只读的，那就不需要进行依赖收集，直接返回
  if (isReadonly(target)) {
    return target
  }
  // To: createReactiveObject
  // Return From createReactiveObject: 返回经过proxy代理的对象，这个proxy代理取决于handlers
  // 返回createReactiveObject方法调用结果
  return createReactiveObject(
    target,
    false,
    mutableHandlers,
    mutableCollectionHandlers,
    reactiveMap
  )
}

export declare const ShallowReactiveMarker: unique symbol

export type ShallowReactive<T> = T & { [ShallowReactiveMarker]?: true }

/**
 * Return a shallowly-reactive copy of the original object, where only the root
 * level properties are reactive. It also does not auto-unwrap refs (even at the
 * root level).
 */
export function shallowReactive<T extends object>(
  target: T
): ShallowReactive<T> {
  return createReactiveObject(
    target,
    false,
    shallowReactiveHandlers,
    shallowCollectionHandlers,
    shallowReactiveMap
  )
}

type Primitive = string | number | boolean | bigint | symbol | undefined | null
type Builtin = Primitive | Function | Date | Error | RegExp
export type DeepReadonly<T> = T extends Builtin
  ? T
  : T extends Map<infer K, infer V>
  ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
  : T extends ReadonlyMap<infer K, infer V>
  ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
  : T extends WeakMap<infer K, infer V>
  ? WeakMap<DeepReadonly<K>, DeepReadonly<V>>
  : T extends Set<infer U>
  ? ReadonlySet<DeepReadonly<U>>
  : T extends ReadonlySet<infer U>
  ? ReadonlySet<DeepReadonly<U>>
  : T extends WeakSet<infer U>
  ? WeakSet<DeepReadonly<U>>
  : T extends Promise<infer U>
  ? Promise<DeepReadonly<U>>
  : T extends Ref<infer U>
  ? Readonly<Ref<DeepReadonly<U>>>
  : T extends {}
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : Readonly<T>

/**
 * Creates a readonly copy of the original object. Note the returned copy is not
 * made reactive, but `readonly` can be called on an already reactive object.
 */
export function readonly<T extends object>(
  target: T
): DeepReadonly<UnwrapNestedRefs<T>> {
  return createReactiveObject(
    target,
    true,
    readonlyHandlers,
    readonlyCollectionHandlers,
    readonlyMap
  )
}

/**
 * Returns a reactive-copy of the original object, where only the root level
 * properties are readonly, and does NOT unwrap refs nor recursively convert
 * returned properties.
 * This is used for creating the props proxy object for stateful components.
 */
export function shallowReadonly<T extends object>(target: T): Readonly<T> {
  return createReactiveObject(
    target,
    true,
    shallowReadonlyHandlers,
    shallowReadonlyCollectionHandlers,
    shallowReadonlyMap
  )
}
// From reactive:
// Reutrn To reactive: 返回经过proxy代理的对象，这个proxy代理对象内部的方法取决于handlers
function createReactiveObject(
  target: Target,
  isReadonly: boolean,
  baseHandlers: ProxyHandler<any>,
  collectionHandlers: ProxyHandler<any>,
  proxyMap: WeakMap<Target, any>
) {
  // 如果不是对象，直接返回
  if (!isObject(target)) {
    if (__DEV__) {
      console.warn(`value cannot be made reactive: ${String(target)}`)
    }
    return target
  }
  // target is already a Proxy, return it.
  // exception: calling readonly() on a reactive object
  // 如果目标已经是一个代理(响应式对象)，返回它。
  // 例外：在reactive对象上调用 readonly() 不返回
  if (
    target[ReactiveFlags.RAW] &&
    !(isReadonly && target[ReactiveFlags.IS_REACTIVE])
  ) {
    return target
  }
  // target already has corresponding Proxy
  // 如果对象在proxyMap上，直接返回，防止反复创建代理对象
  const existingProxy = proxyMap.get(target)
  if (existingProxy) {
    return existingProxy
  }
  // only a whitelist of value types can be observed.
  // 只能观察到值类型的白名单。
  // To: getTargetType:
  // Return From getTargetType: 获取target的类型
  // INVALID是除了Object Array Map Set WeakMap WeakSet之外的类型，也就是除了这类型之外的类型，返回
  const targetType = getTargetType(target)
  if (targetType === TargetType.INVALID) {
    return target
  }
  // 执行Proxy代理，对target对象进行代理
  // 会根据TargetType.COLLECTION判断使用哪个handlers进行代理
  // baseHandlers是一般值类型  collectionHandlers是map set这些类型
  // From: createReactiveObject
  // To: baseHandlers
  const proxy = new Proxy(
    target,
    // From: createReactiveObject
    // To: baseHandlers
    // Return From baseHandlers: 返回包含get、set、deleteProperty、ownKeys、has方法的对象
    // To: collectionHandlers
    targetType === TargetType.COLLECTION ? collectionHandlers : baseHandlers
  )
  // 代理完之后，在proxyMap上收集代理对象，防止反复创建代理对象
  proxyMap.set(target, proxy)
  // 返回proxy代理对象 此时proxy上面已经有了get、set、deleteProperty、ownKeys、has这些方法
  return proxy
}
// From proxyRefs:
// Return To proxyRefs: 根据value上是否有ReactiveFlags.IS_REACTIVE属性判断是否是只读
export function isReactive(value: unknown): boolean {
  // 如果是只读的
  if (isReadonly(value)) {
    // 返回isReactive(原始值)
    return isReactive((value as Target)[ReactiveFlags.RAW])
  }
  // 根据value上是否有ReactiveFlags.IS_REACTIVE属性判断是否是只读
  return !!(value && (value as Target)[ReactiveFlags.IS_REACTIVE])
}
// From createSetter:
// Return To createSetter: 根据value上是否有ReactiveFlags.IS_READONLY属性判断是否是只读
export function isReadonly(value: unknown): boolean {
  // 当在创建readonly时，会加上这个属性
  // 所以这里是判断value上是否有ReactiveFlags.IS_READONLY这个属性，
  return !!(value && (value as Target)[ReactiveFlags.IS_READONLY])
}
// From createSetter:
// Return To createSetter: 根据value上是否有ReactiveFlags.IS_SHALLOW属性判断是否是浅响应式
export function isShallow(value: unknown): boolean {
  // 当在创建shallow时，会加上这个属性
  // 所以这里是判断value上是否有ReactiveFlags.IS_SHALLOW这个属性，
  return !!(value && (value as Target)[ReactiveFlags.IS_SHALLOW])
}

export function isProxy(value: unknown): boolean {
  return isReactive(value) || isReadonly(value)
}
// From createSetter:
// Return To createSetter: 返回原始的代理对象
export function toRaw<T>(observed: T): T {
  // observed上是否有ReactiveFlags.RAW属性
  // 如果有这属性，继续toRaw，直到没有这属性，返回observer
  // 如果没有这属性，返回observed
  const raw = observed && (observed as Target)[ReactiveFlags.RAW]
  return raw ? toRaw(raw) : observed
}

export function markRaw<T extends object>(value: T): T {
  def(value, ReactiveFlags.SKIP, true)
  return value
}
// From RefImpl get:
// Return To RefImpl get: 如果是对象，返回reactive(value)，如果不是对象，返回value
export const toReactive = <T extends unknown>(value: T): T =>
  isObject(value) ? reactive(value) : value
// From get:
// Return To get: 如果是对象，返回readonly(value)，如果不是对象，返回value
export const toReadonly = <T extends unknown>(value: T): T =>
  isObject(value) ? readonly(value as Record<any, any>) : value
