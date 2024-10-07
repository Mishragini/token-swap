'use client'
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowDownIcon, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Search } from "lucide-react";
import axios from 'axios';
import { useToast } from '@/hooks/use-toast';
import { VersionedTransaction } from '@solana/web3.js';

interface Token {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    logoURI: string;
}

export default function TokenSwap() {
    const wallet = useWallet();
    const { connection } = useConnection();
    const [mounted, setMounted] = useState(false);
    const [tokens, setTokens] = useState<Token[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [isSelectingInput, setIsSelectingInput] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const quoteRespRef = useRef(null);

    // Loading states
    const [isLoadingTokens, setIsLoadingTokens] = useState(true);
    const [isLoadingQuote, setIsLoadingQuote] = useState(false);
    const [isSwapping, setIsSwapping] = useState(false);
    const [quoteError, setQuoteError] = useState<string | null>(null);

    const [inputToken, setInputToken] = useState<Token>({
        address: 'So11111111111111111111111111111111111111112',
        symbol: 'SOL',
        name: 'Solana',
        decimals: 9,
        logoURI: ''
    });
    const [outputToken, setOutputToken] = useState<Token | null>(null);
    const [sellAmount, setSellAmount] = useState('0');
    const [buyAmount, setBuyAmount] = useState('0');

    const { toast } = useToast()

    useEffect(() => {
        setMounted(true);
        const fetchTokens = async () => {
            setIsLoadingTokens(true);
            try {
                const response = await axios.get<Token[]>('https://token.jup.ag/strict');
                setTokens(response.data);
            } catch (error) {
                toast({
                    variant: "destructive",
                    title: "Error fetching tokens",
                    description: `${error}`,
                    duration: 2000,
                });
            } finally {
                setIsLoadingTokens(false);
            }
        };
        fetchTokens();
    }, []);

    // Debounced quote fetching
    useEffect(() => {
        let timeoutId: NodeJS.Timeout;

        if (inputToken && outputToken && parseFloat(sellAmount) > 0) {
            setIsLoadingQuote(true);
            setQuoteError(null);

            timeoutId = setTimeout(async () => {
                try {
                    const response = await axios.get(
                        `https://quote-api.jup.ag/v6/quote?inputMint=${inputToken.address}&outputMint=${outputToken.address}&amount=${parseFloat(sellAmount) * Math.pow(10, inputToken.decimals)}&slippageBps=50`
                    );
                    const quoteResponse = response.data;
                    quoteRespRef.current = quoteResponse;
                    const outAmount = quoteResponse.outAmount / Math.pow(10, outputToken.decimals);
                    setBuyAmount(outAmount.toString());
                } catch (e) {
                    console.log(e);
                    setQuoteError("Could not get quote. Please verify your inputs.");
                    setBuyAmount('0');
                } finally {
                    setIsLoadingQuote(false);
                }
            }, 500);
        }

        return () => clearTimeout(timeoutId);
    }, [inputToken, outputToken, sellAmount]);

    const filteredTokens = tokens.filter(token =>
        token.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        token.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const handleTokenSelect = (token: Token) => {
        if (isSelectingInput) {
            setInputToken(token);
        } else {
            setOutputToken(token);
        }
        setDialogOpen(false);
    };

    const swapTokens = useCallback(async () => {
        if (!wallet || !wallet.publicKey || !connection || !wallet.signTransaction) {
            toast({
                variant: "destructive",
                title: "Wallet not connected.",
                description: "Please connect your wallet, and try again",
                duration: 2000,
            });
            return;
        }

        if (!inputToken || !outputToken || !sellAmount || parseFloat(sellAmount) <= 0) {
            toast({
                variant: "destructive",
                title: "Incomplete data.",
                description: "Please select tokens and enter a valid amount.",
                duration: 2000,
            });
            return;
        }

        setIsSwapping(true);
        try {
            const quoteResp = quoteRespRef.current;
            if (!quoteResp) {
                throw new Error('No quote response available.');
            }

            const { data: { swapTransaction } } = await axios.post('https://quote-api.jup.ag/v6/swap', {
                quoteResponse: quoteResp,
                userPublicKey: wallet.publicKey.toString(),
            });

            const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
            const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

            const signedTx = await wallet.signTransaction(transaction);
            const latestBlockHash = await connection.getLatestBlockhash();
            const rawTransaction = signedTx.serialize();
            const txid = await connection.sendRawTransaction(rawTransaction, {
                skipPreflight: true,
                maxRetries: 2,
            });

            toast({
                variant: "default",
                title: "Transaction submitted",
                description: "Waiting for confirmation...",
                duration: 2000,
            });

            await connection.confirmTransaction({
                blockhash: latestBlockHash.blockhash,
                lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
                signature: txid,
            });

            toast({
                variant: "default",
                title: "Swap successful!",
                description: `Transaction ID: ${txid}`,
                duration: 3000,
            });

            // Reset amounts after successful swap
            setSellAmount('0');
            setBuyAmount('0');

            return txid;
        } catch (error) {
            console.error('Swap failed:', error);
            toast({
                variant: "destructive",
                title: "Swap Failed",
                description: "An error occurred during the swap.",
                duration: 2000,
            });
        } finally {
            setIsSwapping(false);
        }
    }, [wallet.publicKey, connection, inputToken, outputToken, sellAmount]);

    if (!mounted) return null;

    return (
        <div className='bg-black h-screen p-4'>
            <div className='flex justify-end w-full'>
                <WalletMultiButton />
            </div>
            <div className="text-white flex flex-col items-center justify-center mt-[200px]">
                <div className="text-center mb-8">
                    <h1 className="text-5xl font-bold mb-2">Swap anytime,</h1>
                    <h1 className="text-5xl font-bold">anywhere.</h1>
                </div>

                <Card className="w-full max-w-md bg-zinc-900 border-zinc-800">
                    <CardContent className="pt-6">
                        {/* Sell section */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-zinc-400">Sell</span>
                            </div>
                            <div className="flex gap-2">
                                <Input
                                    type="number"
                                    value={sellAmount}
                                    onChange={(e) => setSellAmount(e.target.value)}
                                    className="bg-zinc-800 border-none text-2xl text-zinc-400"
                                    disabled={isSwapping}
                                />
                                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                                    <DialogTrigger asChild>
                                        <Button
                                            variant="outline"
                                            onClick={() => setIsSelectingInput(true)}
                                            className="w-[140px] bg-white border-none flex items-center gap-2"
                                            disabled={isSwapping}
                                        >
                                            {inputToken.logoURI && (
                                                <img
                                                    src={inputToken.logoURI}
                                                    alt={inputToken.symbol}
                                                    className="w-5 h-5 rounded-full"
                                                />
                                            )}
                                            <span>{inputToken ? inputToken.symbol : 'Select'}</span>
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent className="bg-zinc-900 text-white">
                                        <DialogHeader>
                                            <DialogTitle>Select Token</DialogTitle>
                                        </DialogHeader>
                                        <div className="flex items-center border border-zinc-700 rounded-lg p-2 mb-4">
                                            <Search className="w-4 h-4 mr-2 text-zinc-400" />
                                            <Input
                                                placeholder="Search tokens..."
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                className="border-none bg-transparent text-white focus:ring-0"
                                            />
                                        </div>
                                        <div className="max-h-[300px] overflow-y-auto">
                                            {isLoadingTokens ? (
                                                <div className="flex justify-center py-4">
                                                    <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
                                                </div>
                                            ) : (
                                                filteredTokens.map((token) => (
                                                    <Button
                                                        key={token.address}
                                                        variant="ghost"
                                                        className="w-full justify-start mb-2 text-white hover:bg-zinc-800"
                                                        onClick={() => handleTokenSelect(token)}
                                                    >
                                                        <img
                                                            src={token.logoURI || '/api/placeholder/24/24'}
                                                            alt={token.symbol}
                                                            className="w-6 h-6 rounded-full mr-2"
                                                        />
                                                        <span>{token.symbol}</span>
                                                    </Button>
                                                ))
                                            )}
                                        </div>
                                    </DialogContent>
                                </Dialog>
                            </div>
                        </div>

                        {/* Swap direction indicator */}
                        <div className="flex justify-center my-2">
                            <div className="bg-zinc-800 p-2 rounded-full">
                                <ArrowDownIcon className="h-6 w-6 text-zinc-400" />
                            </div>
                        </div>

                        {/* Buy section */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-zinc-400">Buy</span>
                                {isLoadingQuote && (
                                    <span className="text-sm text-zinc-400 flex items-center gap-2">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Fetching quote...
                                    </span>
                                )}
                            </div>
                            <div className="flex gap-2">
                                <Input
                                    type="number"
                                    value={buyAmount}
                                    className="bg-zinc-800 border-none text-2xl text-zinc-400"
                                    disabled
                                />
                                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                                    <DialogTrigger asChild>
                                        <Button
                                            onClick={() => setIsSelectingInput(false)}
                                            className="w-[140px] bg-purple-600 hover:bg-purple-700 border-none text-white"
                                            disabled={isSwapping}
                                        >
                                            {outputToken ? (
                                                <div className="flex items-center gap-2">
                                                    <img
                                                        src={outputToken.logoURI}
                                                        alt={outputToken.symbol}
                                                        className="w-5 h-5 rounded-full"
                                                    />
                                                    <span>{outputToken.symbol}</span>
                                                </div>
                                            ) : (
                                                "Select token"
                                            )}
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent className="bg-zinc-900 text-white">
                                        <DialogHeader>
                                            <DialogTitle>Select Token</DialogTitle>
                                        </DialogHeader>
                                        <div className="flex items-center border border-zinc-700 rounded-lg p-2 mb-4">
                                            <Search className="w-4 h-4 mr-2 text-zinc-400" />
                                            <Input
                                                placeholder="Search tokens..."
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                className="border-none bg-transparent text-white focus:ring-0"
                                            />
                                        </div>
                                        <div className="max-h-[300px] overflow-y-auto">
                                            {isLoadingTokens ? (
                                                <div className="flex justify-center py-4">
                                                    <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
                                                </div>
                                            ) : (
                                                filteredTokens.map((token) => (
                                                    <Button
                                                        key={token.address}
                                                        variant="ghost"
                                                        className="w-full justify-start mb-2 text-white hover:bg-zinc-800"
                                                        onClick={() => handleTokenSelect(token)}
                                                    >
                                                        <img
                                                            src={token.logoURI || '/api/placeholder/24/24'}
                                                            alt={token.symbol}
                                                            className="w-6 h-6 rounded-full mr-2"
                                                        />
                                                        <span>{token.symbol}</span>
                                                    </Button>
                                                ))
                                            )}
                                        </div>
                                    </DialogContent>
                                </Dialog>
                            </div>
                        </div>

                        {/* Quote error message */}
                        {quoteError && (
                            <div className="mt-2 text-red-400 text-sm text-center">
                                {quoteError}
                            </div>
                        )}

                        {/* Swap button */}
                        <Button
                            onClick={swapTokens}
                            className="w-full mt-4 bg-purple-600 hover:bg-purple-700 text-white"
                            disabled={!wallet.publicKey || isSwapping || isLoadingQuote || !!quoteError}
                        >
                            {!wallet.publicKey ? (
                                'Connect Wallet to Swap'
                            ) : isSwapping ? (
                                <div className="flex items-center justify-center gap-2">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Swapping...
                                </div>
                            ) : (
                                'Swap'
                            )}
                        </Button>

                        {/* Footer text */}
                        <p className="text-center text-zinc-400 text-sm mt-4">
                            The largest onchain marketplace. Buy and sell crypto on Solana.
                        </p>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}