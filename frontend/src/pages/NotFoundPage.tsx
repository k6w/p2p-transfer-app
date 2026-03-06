import { useNavigate } from 'react-router-dom';
import { Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="container mx-auto px-4 py-4 sm:py-8 max-w-2xl">
      <div className="flex items-center justify-center min-h-[400px]">
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="text-center text-2xl">404</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-muted-foreground">page not found</p>
            <Button onClick={() => navigate('/')} className="h-12 text-base">
              <Home className="h-4 w-4 mr-2" />
              go home
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
