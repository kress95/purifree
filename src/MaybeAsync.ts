import { Maybe, Just, Nothing } from './Maybe'
import { EitherAsync } from './EitherAsync'

export interface MaybeAsyncTypeRef {
  /** Constructs a MaybeAsync object from a function that takes an object full of helpers that let you lift things into the MaybeAsync context and returns a Promise */
  <T>(runPromise: (helpers: MaybeAsyncHelpers) => PromiseLike<T>): MaybeAsync<T>
  /** Constructs an MaybeAsync object from a function that returns a Maybe wrapped in a Promise */
  fromPromise<T>(f: () => Promise<Maybe<T>>): MaybeAsync<T>
  /** Constructs an MaybeAsync object from a function that returns a Promise */
  liftPromise<T>(f: () => Promise<T>): MaybeAsync<T>
  /** Constructs an MaybeAsync object from a Maybe */
  liftMaybe<T>(maybe: Maybe<T>): MaybeAsync<T>
}

export interface MaybeAsync<T> extends PromiseLike<Maybe<T>> {
  /**
   * It's important to remember how `run` will behave because in an
   * async context there are other ways for a function to fail other
   * than to return a Nothing, for example:
   * If any of the computations inside MaybeAsync resolved to Nothing,
   * `run` will return a Promise resolved to Nothing.
   * If any of the promises were to be rejected then `run` will return
   * a Promise resolved to Nothing.
   * If an exception is thrown then `run` will return a Promise
   * resolved to Nothing.
   * If none of the above happen then a promise resolved to the
   * returned value wrapped in a Just will be returned.
   */
  run(): Promise<Maybe<T>>
  /** Transforms the value inside `this` with a given function. If the MaybeAsync that is being mapped resolves to Nothing then the mapping function won't be called and `run` will resolve the whole thing to Nothing, just like the regular Maybe#map */
  map<U>(f: (value: T) => U): MaybeAsync<U>
  /** Transforms `this` with a function that returns a `MaybeAsync`. Behaviour is the same as the regular Maybe#chain */
  chain<U>(f: (value: T) => PromiseLike<Maybe<U>>): MaybeAsync<U>
  /** Converts `this` to a EitherAsync with a default error value */
  toEitherAsync<L>(error: L): EitherAsync<L, T>
  /** Runs an effect if `this` is `Just`, returns `this` to make chaining other methods possible */
  ifJust(effect: (value: T) => any): MaybeAsync<T>
  /** Runs an effect if `this` is `Nothing`, returns `this` to make chaining other methods possible */
  ifNothing(effect: () => any): MaybeAsync<T>

  /** Maps the future value of `this` with another future `Maybe` function */
  ap<U>(maybeF: MaybeAsync<(value: T) => U>): MaybeAsync<U>
  /** Returns the first `Just` between the future value of `this` and another future `Maybe` or future `Nothing` if both `this` and the argument are `Nothing` */
  alt(other: MaybeAsync<T>): MaybeAsync<T>
  /** Returns `this` if this resolves to `Nothing`, otherwise it returns the future result of applying the function argument to future value `this` and wrapping it in a `Just` */
  extend<U>(f: (value: MaybeAsync<T>) => U): MaybeAsync<U>
  /** Takes a predicate function and returns `this` if the predicate resolved to true or Nothing if it resolves to false */
  filter(pred: (value: T) => boolean): MaybeAsync<T>
  /** Flattens nested Maybes. `m.join()` is equivalent to `m.chain(x => x)` */
  join<U>(this: MaybeAsync<MaybeAsync<U>>): MaybeAsync<U>

  'fantasy-land/map'<U>(f: (value: T) => U): MaybeAsync<U>
  'fantasy-land/chain'<U>(f: (value: T) => PromiseLike<Maybe<U>>): MaybeAsync<U>

  'fantasy-land/ap'<U>(maybeF: MaybeAsync<(value: T) => U>): MaybeAsync<U>
  'fantasy-land/alt'(other: MaybeAsync<T>): MaybeAsync<T>
  'fantasy-land/extend'<U>(f: (value: MaybeAsync<T>) => U): MaybeAsync<U>
  'fantasy-land/filter'(pred: (value: T) => boolean): MaybeAsync<T>

  /** WARNING: This is implemented only for Promise compatibility. Please use `chain` instead. */
  then: PromiseLike<Maybe<T>>['then']
}

export interface MaybeAsyncValue<T> extends PromiseLike<T> {}

export interface MaybeAsyncHelpers {
  /** Allows you to take a regular Maybe value and lift it to the MaybeAsync context. Awaiting a lifted Maybe will give you the value inside. If the Maybe is Nothing then the function will exit immediately and MaybeAsync will resolve to Nothing after running it */
  liftMaybe<T>(maybe: Maybe<T>): MaybeAsyncValue<T>
  /** Allows you to take a Maybe inside a Promise and lift it to the MaybeAsync context. Awaiting a lifted Promise<Maybe> will give you the value inside the Maybe. If the Maybe is Nothing or the Promise is rejected then the function will exit immediately and MaybeAsync will resolve to Nothing after running it */
  fromPromise<T>(promise: PromiseLike<Maybe<T>>): MaybeAsyncValue<T>
}

const helpers: MaybeAsyncHelpers = {
  liftMaybe<T>(maybe: Maybe<T>): MaybeAsyncValue<T> {
    if (maybe.isJust()) {
      return Promise.resolve(maybe.extract())
    }

    throw Nothing
  },
  fromPromise<T>(promise: PromiseLike<Maybe<T>>): MaybeAsyncValue<T> {
    return promise.then(helpers.liftMaybe) as MaybeAsyncValue<T>
  }
}

class MaybeAsyncImpl<T> implements MaybeAsync<T> {
  [Symbol.toStringTag]: 'MaybeAsync' = 'MaybeAsync'

  constructor(
    private runPromise: (helpers: MaybeAsyncHelpers) => PromiseLike<T>
  ) {}
  join<U>(this: MaybeAsync<MaybeAsync<U>>): MaybeAsync<U> {
    return MaybeAsync(async (helpers) => {
      const maybe = await this.run()
      if (maybe.isJust()) {
        const nestedMaybe = await maybe.extract()
        return helpers.liftMaybe(nestedMaybe)
      }
      return helpers.liftMaybe(Nothing as Maybe<U>)
    })
  }
  ap<U>(maybeF: MaybeAsync<(value: T) => U>): MaybeAsync<U> {
    return MaybeAsync(async (helpers) => {
      const value = await this.run()
      const maybe = await maybeF
      return helpers.liftMaybe(value.ap(maybe))
    })
  }
  'fantasy-land/ap' = this.ap
  alt(other: MaybeAsync<T>): MaybeAsync<T> {
    return MaybeAsync(async (helpers) => {
      const value = await this.run()
      const maybe = await other
      return helpers.liftMaybe(value.alt(maybe))
    })
  }
  'fantasy-land/alt' = this.alt
  extend<U>(f: (value: MaybeAsync<T>) => U): MaybeAsync<U> {
    return MaybeAsync(async (helpers) => {
      const maybe = await this.run()
      if (maybe.isJust()) {
        const v = MaybeAsync.liftMaybe((maybe as any) as Maybe<T>)
        return helpers.liftMaybe(Just(f(v)))
      }
      return helpers.liftMaybe((Nothing as any) as Maybe<U>)
    })
  }
  'fantasy-land/extend' = this.extend
  filter(pred: (value: T) => boolean): MaybeAsync<T> {
    return MaybeAsync(async (helpers) => {
      const value = await this.run()
      return helpers.liftMaybe(value.filter(pred))
    })
  }
  'fantasy-land/filter' = this.filter

  async run(): Promise<Maybe<T>> {
    try {
      return Just(await this.runPromise(helpers))
    } catch {
      return Nothing
    }
  }

  map<U>(f: (value: T) => U): MaybeAsync<U> {
    return MaybeAsync((helpers) => this.runPromise(helpers).then(f))
  }

  chain<U>(f: (value: T) => PromiseLike<Maybe<U>>): MaybeAsync<U> {
    return MaybeAsync(async (helpers) => {
      const value = await this.runPromise(helpers)
      return helpers.fromPromise(f(value))
    })
  }

  toEitherAsync<L>(error: L): EitherAsync<L, T> {
    return EitherAsync(async ({ liftEither }) => {
      const maybe = await this.run()
      return liftEither(maybe.toEither(error))
    })
  }

  ifJust(effect: (value: T) => any): MaybeAsync<T> {
    return MaybeAsync(async (helpers) => {
      const maybe = await this.run()
      maybe.ifJust(effect)
      return helpers.liftMaybe(maybe)
    })
  }

  ifNothing(effect: () => any): MaybeAsync<T> {
    return MaybeAsync(async (helpers) => {
      const maybe = await this.run()
      maybe.ifNothing(effect)
      return helpers.liftMaybe(maybe)
    })
  }

  'fantasy-land/map'<U>(f: (value: T) => U): MaybeAsync<U> {
    return this.map(f)
  }

  'fantasy-land/chain'<U>(
    f: (value: T) => PromiseLike<Maybe<U>>
  ): MaybeAsync<U> {
    return this.chain(f)
  }

  then<TResult1 = Maybe<T>, TResult2 = never>(
    onfulfilled?:
      | ((value: Maybe<T>) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?:
      | ((reason: any) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected)
  }
}

export const MaybeAsync: MaybeAsyncTypeRef = Object.assign(
  <T>(
    runPromise: (helpers: MaybeAsyncHelpers) => PromiseLike<T>
  ): MaybeAsync<T> => new MaybeAsyncImpl(runPromise),
  {
    fromPromise: <T>(f: () => Promise<Maybe<T>>): MaybeAsync<T> =>
      MaybeAsync(({ fromPromise: fP }) => fP(f())),
    liftPromise: <T>(f: () => Promise<T>): MaybeAsync<T> => MaybeAsync(f),
    liftMaybe: <T>(maybe: Maybe<T>): MaybeAsync<T> =>
      MaybeAsync(({ liftMaybe }) => liftMaybe(maybe))
  }
)

MaybeAsyncImpl.prototype.constructor = MaybeAsync
