import {
  activeEffect,
  shouldTrack,
  trackEffects,
  triggerEffects
} from './effect'
import { TrackOpTypes, TriggerOpTypes } from './operations'
import { isArray, hasChanged, IfAny } from '@vue/shared'
import { isProxy, toRaw, isReactive, toReactive } from './reactive'
import type { ShallowReactiveMarker } from './reactive'
import { CollectionTypes } from './collectionHandlers'
import { createDep, Dep } from './dep'

declare const RefSymbol: unique symbol

export interface Ref<T = any> {
  value: T
  /**
   * Type differentiator only.
   * We need this to be in public d.ts but don't want it to show up in IDE
   * autocomplete, so we use a private Symbol instead.
   */
  [RefSymbol]: true
}

type RefBase<T> = {
  dep?: Dep
  value: T
}
// From RefImpl:
// Return To RefImpl: 调用trackEffects收集依赖
export function trackRefValue(ref: RefBase<any>) {
  // 判断shouldTrack和activeEffect
  if (shouldTrack && activeEffect) {
    // 如果shouldTrack为true，并且activeEffect不为null，使用toRaw获取原始ref
    ref = toRaw(ref)
    // DEV忽略
    if (__DEV__) {
      trackEffects(ref.dep || (ref.dep = createDep()), {
        target: ref,
        type: TrackOpTypes.GET,
        key: 'value'
      })
    } else {
      // 调用trackEffects方法收集依赖
      trackEffects(ref.dep || (ref.dep = createDep()))
    }
  }
}
// From RefImpl:
// Return To RefImpl: 调用triggerEffects触发依赖，执行副作用函数
export function triggerRefValue(ref: RefBase<any>, newVal?: any) {
  // toRaw获取原始ref
  ref = toRaw(ref)
  // 如果ref.dep存在
  if (ref.dep) {
    // DEV忽略
    if (__DEV__) {
      triggerEffects(ref.dep, {
        target: ref,
        type: TriggerOpTypes.SET,
        key: 'value',
        newValue: newVal
      })
    } else {
      // 调用triggerEffects触发依赖，执行副作用函数
      triggerEffects(ref.dep)
    }
  }
}
// From createSetter createGetter:
// Return To createSetter createGetter: 判断r上是否有__v_isRef属性，判断是否是Ref
export function isRef<T>(r: Ref<T> | unknown): r is Ref<T>
export function isRef(r: any): r is Ref {
  // 判断r上是否有__v_isRef属性
  return !!(r && r.__v_isRef === true)
}
// ref
// 创建一个RefImpl对象，此对象对value设置了getter和setter，当get的时候依赖收集，set的时候触发依赖
export function ref<T extends object>(
  value: T
): [T] extends [Ref] ? T : Ref<UnwrapRef<T>>
export function ref<T>(value: T): Ref<UnwrapRef<T>>
export function ref<T = any>(): Ref<T | undefined>
export function ref(value?: unknown) {
  // From ref:
  // To createRef:
  // Return From createRef: 返回RefImpl对象，此对象对value设置了getter和setter
  return createRef(value, false)
}

declare const ShallowRefMarker: unique symbol

export type ShallowRef<T = any> = Ref<T> & { [ShallowRefMarker]?: true }

export function shallowRef<T extends object>(
  value: T
): T extends Ref ? T : ShallowRef<T>
export function shallowRef<T>(value: T): ShallowRef<T>
export function shallowRef<T = any>(): ShallowRef<T | undefined>
export function shallowRef(value?: unknown) {
  return createRef(value, true)
}
// From ref:
// Return To ref: 返回RefImpl对象，此对象对value设置了getter和setter
function createRef(rawValue: unknown, shallow: boolean) {
  // 判断是否是ref
  if (isRef(rawValue)) {
    // 如果是ref，直接返回
    return rawValue
  }
  // From createRef:
  // To RefImpl:
  // Return From RefImpl: 返回RefImpl对象，此对象对value设置了getter和setter
  // 返回一个RefImpl对象
  return new RefImpl(rawValue, shallow)
}
// From createRef:
// Return To createRef: 返回RefImpl对象，此对象对value设置了getter和setter
class RefImpl<T> {
  private _value: T
  private _rawValue: T

  public dep?: Dep = undefined
  public readonly __v_isRef = true

  constructor(value: T, public readonly __v_isShallow: boolean) {
    // 根据是否是shallow赋值
    // 如果不是shallow rawValue就是原始的value
    this._rawValue = __v_isShallow ? value : toRaw(value)
    // From RefImpl:
    // To: toReactive
    // Retrun From toReactive: 如果是对象，返回reactive(value)，如果不是对象，返回value
    // 如果不是shaollw 如果value是对象，_value是toReactive(value)，如果不是对象，_value是value
    this._value = __v_isShallow ? value : toReactive(value)
  }
  // 对value的getter
  get value() {
    // From RefImpl:
    // To trackRefValue:
    // Return From trackRefValue: 调用trackEffects收集依赖
    // 执行trackRefValue收集依赖
    trackRefValue(this)
    // 返回_value
    return this._value
  }
  // 对value的setter
  set value(newVal) {
    // 如果不是shallow newVal就是newVal的原始值
    newVal = this.__v_isShallow ? newVal : toRaw(newVal)
    // 如果新、旧值发生改变
    if (hasChanged(newVal, this._rawValue)) {
      // 赋值
      this._rawValue = newVal
      // 如果不是shaollw 如果value是对象，_value是toReactive(newVal)，如果不是对象，_value是newVal
      this._value = this.__v_isShallow ? newVal : toReactive(newVal)
      // From RefImpl:
      // To: triggerRefValue
      // Return From triggerRefValue: 调用triggerEffects触发依赖，执行副作用函数
      // 调用triggerRefValue方法触发依赖，执行副作用函数
      triggerRefValue(this, newVal)
    }
  }
}

export function triggerRef(ref: Ref) {
  triggerRefValue(ref, __DEV__ ? ref.value : void 0)
}
// From shallowUnwrapHandlers:
// Return To shallowUnwrapHandlers: 脱ref，也就是如果是ref类型，就返回ref.value，等于做了一层代理，也就是模板中的ref可以不用.value的原因
export function unref<T>(ref: T | Ref<T>): T {
  // 判断是否是ref类型  如果是的话返回ref.value 如果不是的话原样返回
  return isRef(ref) ? (ref.value as any) : ref
}
// From proxyRefs:
// Return To proxyRefs: 
const shallowUnwrapHandlers: ProxyHandler<any> = {
  // From shallowUnwrapHandlers:
  // To unref:
  // Return From unref: 对ref做一层代理，也就是模板中的ref可以不用.value的原因
  // get方法会返回ref.value  unref对ref做了一层代理，也就是模板中的ref可以不用.value的原因
  get: (target, key, receiver) => unref(Reflect.get(target, key, receiver)),
  // 
  set: (target, key, value, receiver) => {
    // 获取老值
    const oldValue = target[key]
    // 如果老值是ref类型 并且新值不是ref类型
    if (isRef(oldValue) && !isRef(value)) {
      // 将新值赋值给老值的value
      oldValue.value = value
      return true
    } else {
      // 返回Reflect.set的返回结果
      return Reflect.set(target, key, value, receiver)
    }
  }
}
// From handleSetupResult:
// Return To handleSetupResult: 如果是ref类型，返回一个新的ref代理对象，此代理对象上拥有get set方法，get方法返回ref.value，set方法赋值给ref.value，做一次代理，也就是模板内ref不用.value的原因
export function proxyRefs<T extends object>(
  objectWithRefs: T
): ShallowUnwrapRef<T> {
  // From proxyRefs:
  // To isReactive:
  // Return From isReactive: 根据value上是否有ReactiveFlags.IS_REACTIVE属性判断是否是只读
  return isReactive(objectWithRefs)
    ? // 如果是reactive对象，原样返回
      objectWithRefs
    : // From proxyRefs:
      // To shallowUnwrapHandlers:
      // Return From shallowUnwrapHandlers: 返回一个拥有get set方法的对象，get方法返回ref.value，set方法赋值给ref.value，做一次代理
      new Proxy(objectWithRefs, shallowUnwrapHandlers)
}

export type CustomRefFactory<T> = (
  track: () => void,
  trigger: () => void
) => {
  get: () => T
  set: (value: T) => void
}

class CustomRefImpl<T> {
  public dep?: Dep = undefined

  private readonly _get: ReturnType<CustomRefFactory<T>>['get']
  private readonly _set: ReturnType<CustomRefFactory<T>>['set']

  public readonly __v_isRef = true

  constructor(factory: CustomRefFactory<T>) {
    const { get, set } = factory(
      () => trackRefValue(this),
      () => triggerRefValue(this)
    )
    this._get = get
    this._set = set
  }

  get value() {
    return this._get()
  }

  set value(newVal) {
    this._set(newVal)
  }
}

export function customRef<T>(factory: CustomRefFactory<T>): Ref<T> {
  return new CustomRefImpl(factory) as any
}

export type ToRefs<T = any> = {
  [K in keyof T]: ToRef<T[K]>
}
export function toRefs<T extends object>(object: T): ToRefs<T> {
  if (__DEV__ && !isProxy(object)) {
    console.warn(`toRefs() expects a reactive object but received a plain one.`)
  }
  const ret: any = isArray(object) ? new Array(object.length) : {}
  for (const key in object) {
    ret[key] = toRef(object, key)
  }
  return ret
}

class ObjectRefImpl<T extends object, K extends keyof T> {
  public readonly __v_isRef = true

  constructor(
    private readonly _object: T,
    private readonly _key: K,
    private readonly _defaultValue?: T[K]
  ) {}

  get value() {
    const val = this._object[this._key]
    return val === undefined ? (this._defaultValue as T[K]) : val
  }

  set value(newVal) {
    this._object[this._key] = newVal
  }
}

export type ToRef<T> = IfAny<T, Ref<T>, [T] extends [Ref] ? T : Ref<T>>

export function toRef<T extends object, K extends keyof T>(
  object: T,
  key: K
): ToRef<T[K]>

export function toRef<T extends object, K extends keyof T>(
  object: T,
  key: K,
  defaultValue: T[K]
): ToRef<Exclude<T[K], undefined>>

export function toRef<T extends object, K extends keyof T>(
  object: T,
  key: K,
  defaultValue?: T[K]
): ToRef<T[K]> {
  const val = object[key]
  return isRef(val)
    ? val
    : (new ObjectRefImpl(object, key, defaultValue) as any)
}

// corner case when use narrows type
// Ex. type RelativePath = string & { __brand: unknown }
// RelativePath extends object -> true
type BaseTypes = string | number | boolean

/**
 * This is a special exported interface for other packages to declare
 * additional types that should bail out for ref unwrapping. For example
 * \@vue/runtime-dom can declare it like so in its d.ts:
 *
 * ``` ts
 * declare module '@vue/reactivity' {
 *   export interface RefUnwrapBailTypes {
 *     runtimeDOMBailTypes: Node | Window
 *   }
 * }
 * ```
 *
 * Note that api-extractor somehow refuses to include `declare module`
 * augmentations in its generated d.ts, so we have to manually append them
 * to the final generated d.ts in our build process.
 */
export interface RefUnwrapBailTypes {}

export type ShallowUnwrapRef<T> = {
  [K in keyof T]: T[K] extends Ref<infer V>
    ? V
    : // if `V` is `unknown` that means it does not extend `Ref` and is undefined
    T[K] extends Ref<infer V> | undefined
    ? unknown extends V
      ? undefined
      : V | undefined
    : T[K]
}

export type UnwrapRef<T> = T extends ShallowRef<infer V>
  ? V
  : T extends Ref<infer V>
  ? UnwrapRefSimple<V>
  : UnwrapRefSimple<T>

export type UnwrapRefSimple<T> = T extends
  | Function
  | CollectionTypes
  | BaseTypes
  | Ref
  | RefUnwrapBailTypes[keyof RefUnwrapBailTypes]
  ? T
  : T extends Array<any>
  ? { [K in keyof T]: UnwrapRefSimple<T[K]> }
  : T extends object & { [ShallowReactiveMarker]?: never }
  ? {
      [P in keyof T]: P extends symbol ? T[P] : UnwrapRef<T[P]>
    }
  : T
