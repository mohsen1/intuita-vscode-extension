/** old-001 **/
{
    class A {
        pa = 1;
        pb = 2;
        pc = 3;

        ma() {
            console.log(this.pa);
        }

        mb() {
            console.log(this.pb);
        }

        mc() {
            console.log(this.pc);
        }
    }
}
/** new-001 **/
{
    class A0 {
        pa = 1;

        ma(): void {
            console.log(this.pa);
        }
    }

    class A1 {
        pb = 2;

        mb(): void {
            console.log(this.pb);
        }
    }

    class A2 {
        pc = 3;

        mc(): void {
            console.log(this.pc);
        }
    }
}
/** old-002 **/
{
    class A<T> {
        readonly pa = 1;
        readonly pb = 2;

        ma<U, V>(a: number): number {
            console.log(a, this.pa);

            return 1;
        }

        mb<U, V, R>(b: string): T | null {
            console.log(b, this.pb);

            return null;
        }
    }
}
/** new-002 **/
{
    class A0<T> {
        readonly pa = 1;

        ma<U, V>(a: number): number {
            console.log(a, this.pa);

            return 1;
        }
    }

    class A1<T> {
        readonly pb = 2;

        mb<U, V, R>(b: string): T | null {
            console.log(b, this.pb);

            return null;
        }
    }
}